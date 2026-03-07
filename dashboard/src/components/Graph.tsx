import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { getGraph } from '../api';
import type { GraphLink, GraphNode, GraphResponse } from '../api';

type SimulationNode = d3.SimulationNodeDatum & GraphNode;
type SimulationLink = d3.SimulationLinkDatum<SimulationNode> & GraphLink;

const RELATIONSHIP_COLORS: Record<string, string> = {
  supports: '#22c55e',
  contradicts: '#ef4444',
  example_of: '#3b82f6',
  caused_by: '#f59e0b',
  related_to: '#6b7280',
};

const INITIAL_FILTERS: Record<string, boolean> = {
  supports: true,
  contradicts: true,
  example_of: true,
  caused_by: true,
  related_to: true,
};

function getRelationshipColor(relationship: string): string {
  return RELATIONSHIP_COLORS[relationship] ?? '#6b7280';
}

export function Graph() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, boolean>>(INITIAL_FILTERS);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; source: string } | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      setError(null);
      const data = await getGraph();
      setGraph(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const filteredGraph = useMemo(() => {
    if (!graph) {
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    }

    const activeTypes = new Set(
      Object.entries(filters)
        .filter(([, enabled]) => enabled)
        .map(([relationship]) => relationship),
    );

    const linksByType = graph.links.filter((link) => activeTypes.has(link.relationship));

    // Build set of all node IDs that actually exist in the response
    const existingNodeIds = new Set(graph.nodes.map((node) => node.id));

    // Filter out links that reference missing nodes (e.g. deleted chunks)
    const links = linksByType.filter(
      (link) => existingNodeIds.has(link.source) && existingNodeIds.has(link.target),
    );

    const linkedNodeIds = new Set<string>();
    for (const link of links) {
      linkedNodeIds.add(link.source);
      linkedNodeIds.add(link.target);
    }

    const nodes = graph.nodes.filter((node) => linkedNodeIds.has(node.id));
    return { nodes, links };
  }, [graph, filters]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const width = svgElement.clientWidth || 960;
    const height = svgElement.clientHeight || 680;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();
    svg.on('.zoom', null);
    viewportRef.current = null;
    zoomBehaviorRef.current = null;
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    if (filteredGraph.nodes.length === 0 || filteredGraph.links.length === 0) {
      return;
    }

    let simulation: d3.Simulation<SimulationNode, SimulationLink> | null = null;

    try {
    const viewport = svg.append('g').attr('class', 'graph-viewport');
    viewportRef.current = viewport.node();

    const nodes: SimulationNode[] = filteredGraph.nodes.map((node) => ({ ...node }));
    const links: SimulationLink[] = filteredGraph.links.map((link) => ({ ...link }));

    const sourceDomain = Array.from(new Set(nodes.map((node) => node.source)));
    const sourceColor = d3.scaleOrdinal<string, string>(d3.schemeTableau10).domain(sourceDomain);

    const accessExtent = d3.extent(nodes, (node) => node.access_count) as [number, number];
    const minAccess = Number.isFinite(accessExtent[0]) ? accessExtent[0] : 0;
    const maxAccess = Number.isFinite(accessExtent[1]) ? accessExtent[1] : minAccess + 1;
    const radiusScale = d3.scaleSqrt().domain([minAccess, maxAccess]).range([6, 20]);
    if (minAccess === maxAccess) {
      radiusScale.domain([0, maxAccess + 1]);
    }

    const sim = d3
      .forceSimulation<SimulationNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<SimulationNode, SimulationLink>(links)
          .id((node) => node.id)
          .distance((link) => 110 - Math.min(50, (link.weight ?? 0.1) * 80)),
      )
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimulationNode>().radius((node) => radiusScale(node.access_count) + 4));

    const linkSelection = viewport
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (link) => getRelationshipColor(link.relationship))
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', (link) => Math.max(1, (link.weight ?? 0.1) * 6));

    const nodeSelection = viewport
      .append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (node) => radiusScale(node.access_count))
      .attr('fill', (node) => sourceColor(node.source))
      .attr('stroke', (node) => (node.contradiction_flag === 1 ? '#ef4444' : '#0f1117'))
      .attr('stroke-width', (node) => (node.contradiction_flag === 1 ? 2.5 : 1.5))
      .on('mouseenter', (event, node) => {
        setTooltip({
          x: event.clientX,
          y: event.clientY,
          text: node.text,
          source: node.source,
        });
      })
      .on('mousemove', (event) => {
        setTooltip((current) =>
          current
            ? {
                ...current,
                x: event.clientX,
                y: event.clientY,
              }
            : null,
        );
      })
      .on('mouseleave', () => {
        setTooltip(null);
      });

    const drag = d3
      .drag<SVGCircleElement, SimulationNode>()
      .on('start', (event, node) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on('drag', (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on('end', (event, node) => {
        if (!event.active) sim.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      });

    (nodeSelection as d3.Selection<SVGCircleElement, SimulationNode, SVGGElement, unknown>).call(drag);

    sim.on('tick', () => {
      linkSelection
        .attr('x1', (link) => (link.source as SimulationNode).x ?? 0)
        .attr('y1', (link) => (link.source as SimulationNode).y ?? 0)
        .attr('x2', (link) => (link.target as SimulationNode).x ?? 0)
        .attr('y2', (link) => (link.target as SimulationNode).y ?? 0);

      nodeSelection.attr('cx', (node) => node.x ?? 0).attr('cy', (node) => node.y ?? 0);
    });

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 6])
      .on('zoom', (event) => {
        viewport.attr('transform', event.transform.toString());
      });

    zoomBehaviorRef.current = zoomBehavior;
    svg.call(zoomBehavior);

    simulation = sim;
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : 'Failed to render graph');
    }

    return () => {
      simulation?.stop();
      svg.on('.zoom', null);
    };
  }, [filteredGraph]);

  const onFitToScreen = useCallback(() => {
    const svgElement = svgRef.current;
    const viewportElement = viewportRef.current;
    if (!svgElement || !viewportElement) return;

    const svg = d3.select(svgElement);
    const zoomBehavior = zoomBehaviorRef.current;
    if (!zoomBehavior) return;

    const bounds = viewportElement.getBBox();
    const width = svgElement.clientWidth || 960;
    const height = svgElement.clientHeight || 680;
    if (!bounds.width || !bounds.height) return;

    const scale = Math.max(0.1, Math.min(2.5, 0.9 / Math.max(bounds.width / width, bounds.height / height)));
    const translateX = width / 2 - (bounds.x + bounds.width / 2) * scale;
    const translateY = height / 2 - (bounds.y + bounds.height / 2) * scale;

    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    svg.transition().duration(450).call(zoomBehavior.transform, transform);
  }, []);

  if (loading) {
    return (
      <section className="panel graph-panel">
        <h2>Connection Graph</h2>
        <div className="skeleton skeleton-lg" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel graph-panel">
        <h2>Connection Graph</h2>
        <p className="error">API error: {error}</p>
      </section>
    );
  }

  return (
    <section className="panel graph-panel">
      <div className="panel-header">
        <h2>Connection Graph</h2>
        <button type="button" className="button" onClick={onFitToScreen}>
          Fit to screen
        </button>
      </div>

      <div className="filter-row">
        {Object.keys(INITIAL_FILTERS).map((relationship) => (
          <label key={relationship} className="checkbox">
            <input
              type="checkbox"
              checked={Boolean(filters[relationship])}
              onChange={(event) => {
                const checked = event.target.checked;
                setFilters((current) => ({
                  ...current,
                  [relationship]: checked,
                }));
              }}
            />
            <span style={{ color: getRelationshipColor(relationship) }}>{relationship}</span>
          </label>
        ))}
      </div>

      {filteredGraph.nodes.length === 0 ? (
        <div className="empty-state">No connected nodes match the selected relationship filters.</div>
      ) : (
        <div className="graph-wrap">
          <svg ref={svgRef} className="graph-canvas" />
          {tooltip && (
            <div
              className="tooltip"
              style={{
                left: tooltip.x + 14,
                top: tooltip.y + 14,
              }}
            >
              <p>{tooltip.text}</p>
              <span>{tooltip.source}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}