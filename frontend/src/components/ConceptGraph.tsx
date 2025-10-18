import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ConceptNode, ConceptLink, GraphData, MemoryUpdateEvent } from '../types';
import { leafMindWS } from '../services/websocket';

interface ConceptGraphProps {
  width?: number;
  height?: number;
}

const ConceptGraph: React.FC<ConceptGraphProps> = ({ 
  width = 800, 
  height = 600 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<ConceptNode | null>(null);

  // Initialize with sample data for demo
  useEffect(() => {
    const sampleData: GraphData = {
      nodes: [
        { id: '1', label: 'Machine Learning', strength: 0.9, access_count: 25, x: width/2, y: height/2 },
        { id: '2', label: 'Neural Networks', strength: 0.85, access_count: 18, x: width/2 + 100, y: height/2 - 50 },
        { id: '3', label: 'Deep Learning', strength: 0.8, access_count: 22, x: width/2 + 50, y: height/2 + 80 },
        { id: '4', label: 'Pattern Recognition', strength: 0.75, access_count: 12, x: width/2 - 80, y: height/2 - 60 },
        { id: '5', label: 'Data Science', strength: 0.7, access_count: 30, x: width/2 - 100, y: height/2 + 70 },
        { id: '6', label: 'Artificial Intelligence', strength: 0.95, access_count: 35, x: width/2, y: height/2 - 120 },
      ],
      links: [
        { source: '1', target: '2', strength: 0.8, type: 'long-term' },
        { source: '1', target: '3', strength: 0.9, type: 'long-term' },
        { source: '1', target: '4', strength: 0.6, type: 'short-term' },
        { source: '1', target: '5', strength: 0.7, type: 'long-term' },
        { source: '2', target: '3', strength: 0.85, type: 'long-term' },
        { source: '1', target: '6', strength: 0.9, type: 'long-term' },
        { source: '6', target: '2', strength: 0.7, type: 'short-term' },
      ]
    };
    setGraphData(sampleData);
  }, [width, height]);

  // Listen for memory updates
  useEffect(() => {
    leafMindWS.onMemoryUpdate((event: MemoryUpdateEvent) => {
      // Update graph data based on memory updates
      console.log('Memory update received:', event);
    });
  }, []);

  useEffect(() => {
    if (!svgRef.current || graphData.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create main group for zoom behavior
    const g = svg.append('g');

    // Set up zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create simulation
    const simulation = d3.forceSimulation<ConceptNode>(graphData.nodes)
      .force('link', d3.forceLink<ConceptNode, ConceptLink>(graphData.links)
        .id(d => d.id)
        .distance(100)
        .strength(d => d.strength))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create gradient definitions for links
    const defs = svg.append('defs');
    
    const longTermGradient = defs.append('linearGradient')
      .attr('id', 'long-term-gradient')
      .attr('gradientUnits', 'objectBoundingBox');
    
    longTermGradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#0ea5e9')
      .attr('stop-opacity', 0.8);
    
    longTermGradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#0284c7')
      .attr('stop-opacity', 0.6);

    const shortTermGradient = defs.append('linearGradient')
      .attr('id', 'short-term-gradient')
      .attr('gradientUnits', 'objectBoundingBox');
    
    shortTermGradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#d946ef')
      .attr('stop-opacity', 0.6);
    
    shortTermGradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#c026d3')
      .attr('stop-opacity', 0.4);

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(graphData.links)
      .enter().append('line')
      .attr('stroke', d => d.type === 'long-term' ? 'url(#long-term-gradient)' : 'url(#short-term-gradient)')
      .attr('stroke-width', d => Math.sqrt(d.strength * 5))
      .attr('stroke-opacity', d => d.strength)
      .style('pointer-events', 'none');

    // Create nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(graphData.nodes)
      .enter().append('g')
      .attr('class', 'concept-node')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, ConceptNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = undefined;
          d.fy = undefined;
        }));

    // Add circles for nodes
    node.append('circle')
      .attr('r', d => 10 + (d.strength * 15))
      .attr('fill', d => {
        const strengthColor = d3.scaleSequential(d3.interpolateViridis)
          .domain([0, 1]);
        return strengthColor(d.strength);
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('click', (event, d) => {
        setSelectedNode(d);
        // Subscribe to updates for this concept
        if (leafMindWS.isConnected()) {
          leafMindWS.subscribeConcept(d.id);
        }
      })
      .on('mouseover', function(event, d) {
        d3.select(this).transition()
          .duration(200)
          .attr('r', 15 + (d.strength * 15))
          .attr('stroke-width', 3);
      })
      .on('mouseout', function(event, d) {
        d3.select(this).transition()
          .duration(200)
          .attr('r', 10 + (d.strength * 15))
          .attr('stroke-width', 2);
      });

    // Add labels
    node.append('text')
      .text(d => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', d => 25 + (d.strength * 15))
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .attr('fill', '#374151')
      .style('pointer-events', 'none');

    // Add access count indicators
    node.append('text')
      .text(d => d.access_count)
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', '#fff')
      .style('pointer-events', 'none');

    // Update positions on simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as any).x!)
        .attr('y1', d => (d.source as any).y!)
        .attr('x2', d => (d.target as any).x!)
        .attr('y2', d => (d.target as any).y!);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Cleanup function
    return () => {
      simulation.stop();
    };
  }, [graphData, width, height]);

  const handleAddRandomNode = () => {
    const newNode: ConceptNode = {
      id: Date.now().toString(),
      label: `Concept ${graphData.nodes.length + 1}`,
      strength: Math.random(),
      access_count: Math.floor(Math.random() * 50),
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200
    };

    const newLink: ConceptLink = {
      source: graphData.nodes[Math.floor(Math.random() * graphData.nodes.length)].id,
      target: newNode.id,
      strength: Math.random(),
      type: Math.random() > 0.5 ? 'long-term' : 'short-term'
    };

    setGraphData(prev => ({
      nodes: [...prev.nodes, newNode],
      links: [...prev.links, newLink]
    }));
  };

  const handleResetGraph = () => {
    setGraphData({ nodes: [], links: [] });
    setSelectedNode(null);
  };

  return (
    <div className="space-y-4">
      {/* Header and Controls */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🧠 Concept Graph</h2>
        <div className="flex space-x-2">
          <button
            onClick={handleAddRandomNode}
            className="px-3 py-2 text-sm bg-brain-600 dark:bg-brain-700 text-white rounded-md hover:bg-brain-700 dark:hover:bg-brain-800 transition-colors duration-300"
          >
            Add Node
          </button>
          <button
            onClick={handleResetGraph}
            className="px-3 py-2 text-sm bg-gray-600 dark:bg-gray-700 text-white rounded-md hover:bg-gray-700 dark:hover:bg-gray-800 transition-colors duration-300"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Graph Container */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 transition-colors duration-300">
        <div className="flex">
          <div className="flex-1">
            <svg
              ref={svgRef}
              width={width}
              height={height}
              className="border border-gray-200 dark:border-gray-600 rounded transition-colors duration-300"
            />
          </div>
          
          {/* Node Details Panel */}
          {selectedNode && (
            <div className="w-64 ml-4 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Concept Details
              </h3>
              <div className="space-y-2">
                <div>
                  <span className="text-sm font-medium text-gray-700">Label:</span>
                  <p className="text-sm text-gray-900">{selectedNode.label}</p>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">Strength:</span>
                  <div className="flex items-center mt-1">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-brain-600 h-2 rounded-full"
                        style={{ width: `${selectedNode.strength * 100}%` }}
                      />
                    </div>
                    <span className="ml-2 text-sm text-gray-600">
                      {(selectedNode.strength * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">Access Count:</span>
                  <p className="text-sm text-gray-900">{selectedNode.access_count}</p>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="w-full mt-3 px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-2">Legend</h3>
        <div className="flex space-x-6 text-sm">
          <div className="flex items-center">
            <div className="w-4 h-1 bg-gradient-to-r from-brain-500 to-brain-600 mr-2" />
            <span>Long-term connections</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-1 bg-gradient-to-r from-synapse-500 to-synapse-600 mr-2" />
            <span>Short-term connections</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-green-400 rounded-full mr-2" />
            <span>High strength concepts</span>
          </div>
          <div className="flex items-center">
            <div className="w-4 h-4 bg-purple-400 rounded-full mr-2" />
            <span>Low strength concepts</span>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          💡 Click and drag nodes to explore relationships. Node size indicates concept strength.
        </p>
      </div>
    </div>
  );
};

export default ConceptGraph;