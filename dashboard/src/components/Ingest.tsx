import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRecentIngests, ingestFile, ingestUrl } from '../api';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import type { RecentIngest as RecentIngestApi } from '../api';
import { ProgressCard } from './ProgressCard';

type IngestTab = 'file' | 'url';

type RecentIngest = {
  source: string;
  chunksStored: number;
  timestamp: string;
};

type IngestJob = {
  jobId: string;
  source: string;
};

type JobFilter = 'all' | 'active' | 'completed';

const ACCEPTED_FILE_TYPES = '.txt,.md,.pdf,.docx,.html';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function Ingest() {
  const [activeTab, setActiveTab] = useState<IngestTab>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileTagsInput, setFileTagsInput] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlTagsInput, setUrlTagsInput] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmittingFile, setIsSubmittingFile] = useState(false);
  const [isSubmittingUrl, setIsSubmittingUrl] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentIngests, setRecentIngests] = useState<RecentIngest[]>([]);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fileTags = useMemo(() => parseTags(fileTagsInput), [fileTagsInput]);
  const urlTags = useMemo(() => parseTags(urlTagsInput), [urlTagsInput]);

  const mapRecentIngest = (item: RecentIngestApi): RecentIngest => ({
    source: item.source,
    chunksStored: item.chunks_stored,
    timestamp: item.timestamp,
  });

  const refreshRecentIngests = useCallback(async () => {
    const data = await getRecentIngests(5);
    setRecentIngests(data.map(mapRecentIngest));
  }, []);

  useEffect(() => {
    void refreshRecentIngests();
  }, [refreshRecentIngests]);

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) return;

    setSelectedFile(file);
    setErrorMessage(null);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const submitFileIngest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) return;

    setIsSubmittingFile(true);
    setErrorMessage(null);

    try {
      const response = await ingestFile(selectedFile, fileTags);
      setJobs((prev) => [{ jobId: response.jobId, source: selectedFile.name }, ...prev]);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'File ingest failed');
    } finally {
      setIsSubmittingFile(false);
    }
  };

  const submitUrlIngest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!urlValue.trim()) return;

    setIsSubmittingUrl(true);
    setErrorMessage(null);

    try {
      const source = urlValue.trim();
      const response = await ingestUrl(source, urlTags);
      setJobs((prev) => [{ jobId: response.jobId, source }, ...prev]);
      setUrlValue('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'URL ingest failed');
    } finally {
      setIsSubmittingUrl(false);
    }
  };

  useEffect(() => {
    if (jobs.length === 0) return;
    const timer = setInterval(() => {
      void refreshRecentIngests();
    }, 15000);

    return () => clearInterval(timer);
  }, [jobs.length, refreshRecentIngests]);

  const dismissJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.jobId !== jobId));
    void refreshRecentIngests();
  }, [refreshRecentIngests]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Ingest</h2>
      </div>

      <div className="ingest-tabs">
        <button
          type="button"
          className={`nav-item ${activeTab === 'file' ? 'active' : ''}`}
          onClick={() => setActiveTab('file')}
        >
          File Upload
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'url' ? 'active' : ''}`}
          onClick={() => setActiveTab('url')}
        >
          URL
        </button>
      </div>

      {activeTab === 'file' && (
        <form className="ingest-form" onSubmit={submitFileIngest}>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            className="ingest-file-input"
            onChange={onFileSelected}
          />

          <div
            className={`dropzone ${isDragActive ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="dropzone-icon">📄</div>
            <p>Drag and drop a file here</p>
            <p className="muted">or click to browse</p>
            <p className="muted">Accepted: .txt .md .pdf .docx .html</p>
          </div>

          {selectedFile && (
            <div className="ingest-file-meta">
              <strong>{selectedFile.name}</strong>
              <span className="muted">{formatFileSize(selectedFile.size)}</span>
            </div>
          )}

          <input
            type="text"
            className="input"
            placeholder="Optional tags (comma separated)"
            value={fileTagsInput}
            onChange={(event) => setFileTagsInput(event.target.value)}
          />

          <button type="submit" className="button" disabled={isSubmittingFile || !selectedFile}>
            Ingest
          </button>
        </form>
      )}

      {activeTab === 'url' && (
        <form className="ingest-form" onSubmit={submitUrlIngest}>
          <input
            type="url"
            className="input"
            placeholder="https://example.com/article"
            value={urlValue}
            onChange={(event) => setUrlValue(event.target.value)}
            required
          />

          <input
            type="text"
            className="input"
            placeholder="Optional tags (comma separated)"
            value={urlTagsInput}
            onChange={(event) => setUrlTagsInput(event.target.value)}
          />

          <button type="submit" className="button" disabled={isSubmittingUrl || !urlValue.trim()}>
            Ingest
          </button>
        </form>
      )}

      {errorMessage && <p className="error">{errorMessage}</p>}

      {jobs.length > 0 && (
        <>
          <div className="ingest-job-filters" role="tablist" aria-label="Ingest jobs filter">
            <button
              type="button"
              className={`nav-item ${jobFilter === 'all' ? 'active' : ''}`}
              onClick={() => setJobFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`nav-item ${jobFilter === 'active' ? 'active' : ''}`}
              onClick={() => setJobFilter('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`nav-item ${jobFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setJobFilter('completed')}
            >
              Completed
            </button>
          </div>

          <div className="ingest-job-list">
            {jobs.map((job) => (
              <ProgressCard
                key={job.jobId}
                jobId={job.jobId}
                source={job.source}
                filter={jobFilter}
                onDismiss={dismissJob}
              />
            ))}
          </div>
        </>
      )}

      <div className="subpanel">
        <h3>Recent ingests</h3>
        {recentIngests.length === 0 ? (
          <p className="muted">No ingests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Chunks</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentIngests.map((item, index) => (
                  <tr key={`${item.source}-${item.timestamp}-${index}`}>
                    <td>{item.source}</td>
                    <td>{item.chunksStored}</td>
                    <td>{formatTimestamp(item.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
