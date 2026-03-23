import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  MapPin, 
  Link as LinkIcon, 
  FileText, 
  Linkedin, 
  Globe, 
  RefreshCw, 
  CheckCircle2, 
  PenLine,
  Briefcase,
  Home,
  ChevronRight,
  Plus,
  ArrowUpRight,
  ThumbsUp,
  ThumbsDown,
  History,
  Sparkles,
  Settings2,
  Trash2,
  Download,
  Waves,
  AlertCircle,
  X,
  Check,
  ChevronDown,
  Coins,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import Papa from 'papaparse';
import confetti from 'canvas-confetti';

const ZEN_SOUND = 'https://actions.google.com/sounds/v1/water/water_lapping_wind.ogg';

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  link: string;
  found_at: string;
  description: string;
  status: 'new' | 'past' | 'approved' | 'rejected' | 'applied';
  source_url: string;
  salary?: string;
  seniority?: string;
  is_broken?: boolean;
}

interface Profile {
  keywords: string;
  location: string;
  linkedin_url: string;
  min_salary?: number;
  search_mode: 'strict' | 'discovery';
  crawl_interval?: number;
}

interface Source {
  id: number;
  url: string;
  name: string;
  is_broken?: boolean;
  last_error?: string;
  last_crawled?: string;
  jobs_found?: number;
}

interface LastCrawlReport {
  sourcesChecked: number;
  sourcesUnreachable: string[];
  sourcesSkipped: number;
  sourcesWithNoMatches: number;
  newJobsFound: number;
}

type Tab = 'new' | 'past' | 'approved' | 'applied' | 'rejected' | 'settings' | 'sources';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [profile, setProfile] = useState<Profile>({
    keywords: '',
    location: '',
    linkedin_url: '',
    search_mode: 'strict',
    crawl_interval: 3
  });
  const [sources, setSources] = useState<Source[]>([]);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const jobRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const [newKeyword, setNewKeyword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [sourceSort, setSourceSort] = useState<'latest' | 'alpha'>('latest');
  const [isZenMode, setIsZenMode] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [sourceEditModal, setSourceEditModal] = useState<{
    isOpen: boolean;
    sourceId: number;
    name: string;
    url: string;
  } | null>(null);
  const [newJobLink, setNewJobLink] = useState('');
  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'confirm' | 'alert';
    title: string;
    message: string;
    onConfirm?: () => void;
  } | null>(null);

  const showAlert = (title: string, message: string) => {
    setModal({ isOpen: true, type: 'alert', title, message });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ isOpen: true, type: 'confirm', title, message, onConfirm });
  };

  const zenAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProfile();
    fetchSources();
    fetchJobs();
  }, [activeTab]);

  const [lastCrawlReport, setLastCrawlReport] = useState<LastCrawlReport | null>(null);

  useEffect(() => {
    if (isZenMode) {
      if (!zenAudioRef.current) {
        zenAudioRef.current = new Audio();
        zenAudioRef.current.src = ZEN_SOUND;
        zenAudioRef.current.crossOrigin = "anonymous";
        zenAudioRef.current.loop = true;
        zenAudioRef.current.volume = 0.15;
        zenAudioRef.current.preload = 'auto';
      }
      console.log('Attempting to play Zen music...');
      zenAudioRef.current.play()
        .then(() => console.log('Zen music playing'))
        .catch(e => console.log('Zen play blocked or failed:', e));
    } else {
      if (zenAudioRef.current) {
        console.log('Pausing Zen music');
        zenAudioRef.current.pause();
      }
    }
    return () => {
      if (zenAudioRef.current) zenAudioRef.current.pause();
    };
  }, [isZenMode]);

  const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 30000) => {
    console.log(`Fetching: ${url}`, options);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      console.log(`Response from ${url}:`, response.status);
      return response;
    } catch (error) {
      clearTimeout(id);
      console.error(`Fetch error for ${url}:`, error);
      throw error;
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetchWithTimeout('/api/profile');
      if (!res.ok) throw new Error(`Profile fetch failed: ${res.statusText}`);
      const data = await res.json();
      if (data.id) setProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  };

  const fetchSources = async () => {
    try {
      const res = await fetchWithTimeout(`/api/sources?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Sources fetch failed: ${res.statusText}`);
      const data = await res.json();
      setSources(data);
    } catch (err) {
      console.error('Error fetching sources:', err);
    }
  };

  const fetchJobs = async () => {
    try {
      const statusParam = activeTab === 'settings' ? '' : activeTab;
      const res = await fetchWithTimeout(`/api/jobs?status=${statusParam}&t=${Date.now()}`);
      if (!res.ok) throw new Error(`Jobs fetch failed: ${res.statusText}`);
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await fetchWithTimeout('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      await fetchProfile();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetData = () => {
    showConfirm(
      'Reset All Data',
      'Are you sure you want to reset all job search data? This will clear all jobs but keep your profile and sources. This data is stored locally on the server in a database.',
      async () => {
        setIsResetting(true);
        try {
          console.log('Resetting jobs...');
          const res = await fetchWithTimeout('/api/jobs/clear-all', { method: 'POST' });
          if (!res.ok) throw new Error('Failed to reset data');
          setJobs([]); // Clear immediately in UI
          await fetchJobs();
          showAlert('Success', 'Job data has been reset.');
        } catch (err) {
          console.error(err);
          showAlert('Error', 'Failed to reset data.');
        } finally {
          setIsResetting(false);
        }
      }
    );
  };

  const handleUpdateJobLink = async (jobId: string) => {
    if (!newJobLink) return;
    try {
      const res = await fetchWithTimeout(`/api/jobs/${jobId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: newJobLink })
      });
      if (!res.ok) throw new Error('Failed to update link');
      setEditingJobId(null);
      setNewJobLink('');
      await fetchJobs();
      showAlert('Success', 'Job link updated.');
    } catch (err) {
      console.error(err);
      showAlert('Error', 'Failed to update link.');
    }
  };

  const handleBulkSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as string[][];
        if (rows.length === 0) {
          showAlert('Empty File', 'The file is empty.');
          return;
        }

        const isUrl = (s: any) => typeof s === 'string' && (s.toLowerCase().startsWith('http') || s.toLowerCase().includes('www.'));
        const isHeaderUrl = (s: any) => typeof s === 'string' && (s.toLowerCase().includes('url') || s.toLowerCase().includes('link') || s.toLowerCase().includes('website') || s.toLowerCase().includes('careers'));
        const isHeaderName = (s: any) => typeof s === 'string' && (s.toLowerCase().includes('name') || s.toLowerCase().includes('title') || s.toLowerCase().includes('agency') || s.toLowerCase().includes('company'));

        let urlColIndex = -1;
        let nameColIndex = -1;
        let dataStartIndex = -1;

        // 1. Find the first row that contains a URL to identify data start
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const urlIdx = row.findIndex(cell => isUrl(cell));
          if (urlIdx !== -1) {
            urlColIndex = urlIdx;
            dataStartIndex = i;
            
            // 2. Check if the previous row looks like a header
            if (i > 0) {
              const prevRow = rows[i-1];
              const hUrlIdx = prevRow.findIndex(cell => isHeaderUrl(cell));
              const hNameIdx = prevRow.findIndex(cell => isHeaderName(cell));
              
              if (hUrlIdx !== -1 || hNameIdx !== -1) {
                if (hUrlIdx !== -1) urlColIndex = hUrlIdx;
                if (hNameIdx !== -1) nameColIndex = hNameIdx;
                dataStartIndex = i;
              }
            }
            break;
          }
        }

        if (urlColIndex === -1) {
          const firstRow = rows[0];
          const colNames = firstRow.map((c, i) => c || `Column ${i+1}`);
          const selected = window.prompt(`No URL column detected. Which column contains the URL? Available: ${colNames.join(', ')}`);
          if (selected) {
            urlColIndex = colNames.indexOf(selected);
            if (urlColIndex === -1) {
              const match = selected.match(/Column (\d+)/);
              if (match) urlColIndex = parseInt(match[1]) - 1;
            }
            dataStartIndex = 1;
          }
        }

        if (urlColIndex === -1 || urlColIndex >= rows[0].length) {
          showAlert('Import Error', 'No valid URL column selected.');
          return;
        }

        // If name column not found, try to guess it from the row
        if (nameColIndex === -1) {
          const firstDataRow = rows[dataStartIndex];
          nameColIndex = firstDataRow.findIndex((cell, idx) => idx !== urlColIndex && cell && cell.trim().length > 0);
        }

        setIsImporting(true);
        setImportStatus('Importing...');

        for (let i = dataStartIndex; i < rows.length; i++) {
          const row = rows[i];
          const url = row[urlColIndex];
          const name = nameColIndex !== -1 ? row[nameColIndex] : url;

          if (url && isUrl(url)) {
            // Check for duplicates
            const isDuplicate = sources.some(s => s.url.toLowerCase() === url.toLowerCase());
            if (isDuplicate) continue;

            try {
              await fetchWithTimeout('/api/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, name }),
              });
              await fetchSources();
            } catch (err) {
              console.error('Failed to import source:', url, err);
            }
          }
        }

        setImportStatus('All sources imported');
        if (e.target) e.target.value = '';
        
        setTimeout(() => {
          setIsImporting(false);
          setImportStatus('');
        }, 3000);
      }
    });
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceUrl) return;
    setIsAddingSource(true);
    try {
      await fetchWithTimeout('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newSourceUrl, name: newSourceName }),
      });
      setNewSourceUrl('');
      setNewSourceName('');
      await fetchSources();
    } catch (err) {
      console.error(err);
    } finally {
      setIsAddingSource(false);
    }
  };

  const handleDeleteSource = async (id: number) => {
    try {
      await fetchWithTimeout(`/api/sources/${id}`, { method: 'DELETE' });
      await fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateSource = async (id: number, url: string, name: string) => {
    try {
      await fetchWithTimeout(`/api/sources/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name })
      });
      setSourceEditModal(null);
      await fetchSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExportSources = () => {
    if (sources.length === 0) return;
    const csv = Papa.unparse(sources.map(s => ({ Name: s.name, URL: s.url })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `job_scout_sources_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearSources = () => {
    console.log('handleClearSources triggered');
    showConfirm(
      'Clear All Sources',
      'Are you sure you want to delete ALL crawl sources? This cannot be undone.',
      async () => {
        const previousSources = [...sources];
        setSources([]); // Clear immediately in UI
        
        try {
          console.log('Sending POST request to /api/sources/clear-all...');
          const res = await fetchWithTimeout('/api/sources/clear-all', { method: 'POST' });
          
          if (!res.ok) {
            throw new Error(`Failed to clear sources: ${res.statusText}`);
          }
          
          console.log('Sources cleared on server, refreshing list...');
          // Even though we already cleared UI, fetch to be sure and sync
          await fetchSources();
          showAlert('Success', 'All sources have been removed.');
        } catch (err) {
          console.error('Error in handleClearSources:', err);
          setSources(previousSources); // Rollback if failed
          showAlert('Error', 'Failed to clear sources. Check console for details.');
        }
      }
    );
  };

  const handleUpdateJobStatus = async (id: string, status: Job['status']) => {
    try {
      if (status === 'applied') {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#93C5FD', '#1D3557', '#FFFFFF']
        });
      }

      await fetchWithTimeout(`/api/jobs/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      fetchJobs();
    } catch (err) {
      console.error(err);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modal?.isOpen || isCrawling) return;
      
      // Don't trigger if typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.min(prev + 1, jobs.length - 1);
          if (next >= 0 && jobs[next]) {
            jobRefs.current[jobs[next].id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => {
          const next = Math.max(prev - 1, 0);
          if (next >= 0 && jobs[next]) {
            jobRefs.current[jobs[next].id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return next;
        });
      } else if (selectedIndex >= 0 && selectedIndex < jobs.length) {
        const selectedJob = jobs[selectedIndex];
        if (e.key.toLowerCase() === 'j') {
          handleUpdateJobStatus(selectedJob.id, 'approved');
        } else if (e.key.toLowerCase() === 'k') {
          handleUpdateJobStatus(selectedJob.id, 'rejected');
        } else if (e.key.toLowerCase() === 'l') {
          handleUpdateJobStatus(selectedJob.id, 'applied');
        } else if (e.key === 'Enter') {
          window.open(selectedJob.link, '_blank');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jobs, selectedIndex, modal, isCrawling]);

  const handleManualCrawl = async () => {
    if (isCrawling) return;
    setIsCrawling(true);
    setCrawlProgress('Initializing session...');
    let totalNewJobs = 0;
    
    // Report stats
    let sourcesChecked = 0;
    let sourcesUnreachable: string[] = [];
    let sourcesSkipped = 0;
    let sourcesWithNoMatches = 0;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not defined. Please check your environment settings.');
      }

      // Fetch ALL jobs for deduplication
      const allJobsRes = await fetchWithTimeout('/api/jobs?status=all');
      const allJobs: Job[] = allJobsRes.ok ? await allJobsRes.json() : [];
      const existingUrls = new Set(allJobs.map(j => j.link));

      // Start session and move old 'new' jobs to 'past'
      const sessionRes = await fetchWithTimeout('/api/start-crawl-session', { method: 'POST' });
      if (!sessionRes.ok) throw new Error(`Failed to start session: ${sessionRes.statusText}`);
      const { sessionId } = await sessionRes.json();

      const ai = new GoogleGenAI({ apiKey });
      
      const generateWithRetry = async (prompt: string, maxRetries = 5) => {
        let lastError: any;
        for (let i = 0; i < maxRetries; i++) {
          try {
            const result = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: prompt,
              config: { responseMimeType: 'application/json' }
            });
            return result;
          } catch (err: any) {
            lastError = err;
            const errStr = JSON.stringify(err);
            if (err.message?.includes('429') || err.status === 429 || errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
              const waitTime = Math.pow(2, i) * 5000 + Math.random() * 1000;
              setCrawlProgress(`Rate limited. Retrying in ${Math.round(waitTime/1000)}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
            throw err;
          }
        }
        throw lastError;
      };

      const sortedSources = [...sources].sort((a, b) => 
        (a.name || a.url).toLowerCase().localeCompare((b.name || b.url).toLowerCase())
      );
      
      for (const source of sortedSources) {
        // Incremental Crawling Check: Skip if crawled in last X days
        if (source.last_crawled) {
          const lastCrawledDate = new Date(source.last_crawled);
          const now = new Date();
          const diffDays = (now.getTime() - lastCrawledDate.getTime()) / (1000 * 3600 * 24);
          const interval = profile.crawl_interval || 3;
          if (diffDays < interval) {
            console.log(`Skipping ${source.name || source.url} - crawled ${Math.floor(diffDays)} days ago.`);
            sourcesSkipped++;
            continue;
          }
        }

        sourcesChecked++;
        setCrawlProgress(`Fetching content from ${source.name || source.url}...`);
        const contentRes = await fetchWithTimeout(`/api/fetch-content?url=${encodeURIComponent(source.url)}`);
        
        if (!contentRes.ok) {
          let errorDetail = contentRes.statusText;
          try {
            const errJson = await contentRes.json();
            if (errJson.error) errorDetail = errJson.error;
          } catch (e) {}

          sourcesUnreachable.push(source.name || source.url);
          await fetchWithTimeout(`/api/sources/${source.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_broken: true, last_error: errorDetail || 'Fetch failed' })
          });
          continue;
        }
        
        const { text } = await contentRes.json();

        if (!text || text.length < 200) {
          sourcesUnreachable.push(source.name || source.url);
          await fetchWithTimeout(`/api/sources/${source.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_broken: true, last_error: 'Page returned very little content' })
          });
          continue;
        }

        if (source.is_broken) {
          await fetchWithTimeout(`/api/sources/${source.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_broken: false, last_error: null })
          });
        }

        setCrawlProgress(`Analyzing jobs for ${source.name || source.url}...`);
        
        const modeInstructions = profile.search_mode === 'strict' 
          ? `STRICT MODE: Only include jobs that explicitly match at least one of the keywords: ${profile.keywords}.`
          : `DISCOVERY MODE: Use keywords (${profile.keywords}) AND the user's LinkedIn profile (${profile.linkedin_url}) to semantically discover relevant roles.`;

        const prompt = `
          Extract job listings from the following text. 
          
          USER CONTEXT:
          - Keywords: ${profile.keywords}
          - Location: ${profile.location}
          - Minimum Salary: £${profile.min_salary?.toLocaleString() || '30,000'}
          
          SEARCH MODE:
          ${modeInstructions}
          
          CRITICAL FILTERING CRITERIA:
          1. Be thorough but precise. 
          2. Use "OR" logic for keywords.
          3. LOCATION PRECISION (STRICT): The user is looking for jobs in ${profile.location}. 
          4. SALARY EXTRACTION: Look for salary information.
          5. SENIORITY EXTRACTION: Look for seniority level.

          LINK EXTRACTION RULES:
          - Find the MOST DIRECT link to the specific job description page.
          - If the link is relative, make it absolute using the source URL: ${source.url}

          Text to analyze:
          ${text}

          Return a JSON array of objects with these fields:
          - id (a unique string based on title and company)
          - title
          - company
          - location
          - link (absolute URL)
          - description (short summary)
          - salary (e.g., "£40,000 - £50,000" or "Unknown")
          - seniority (e.g., "Senior")

          If no jobs match the criteria, return an empty array [].
        `;

        const result = await generateWithRetry(prompt);
        let extractedJobs: Job[] = JSON.parse(result.text || '[]');
        
        // Deduplication by URL
        const newJobs = extractedJobs.filter(job => !existingUrls.has(job.link));
        
        if (newJobs.length > 0) {
          totalNewJobs += newJobs.length;
          setCrawlProgress(`Saving ${newJobs.length} new jobs from ${source.name || source.url}...`);
          await fetchWithTimeout('/api/save-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobs: newJobs, source_url: source.url, sessionId }),
          });
        } else {
          sourcesWithNoMatches++;
        }

        // Update Source Stats
        await fetchWithTimeout(`/api/sources/${source.id}/crawl-stats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            last_crawled: new Date().toISOString(), 
            jobs_found_increment: newJobs.length 
          })
        });
      }
      
      setLastCrawlReport({
        sourcesChecked,
        sourcesUnreachable,
        sourcesSkipped,
        sourcesWithNoMatches,
        newJobsFound: totalNewJobs
      });

      setCrawlProgress('Crawl complete!');
      setActiveTab('new');
      await fetchJobs();
      await fetchSources();
    } catch (err: any) {
      console.error(err);
      setCrawlProgress(`Error: ${err.message}`);
    } finally {
      setTimeout(() => {
        setIsCrawling(false);
        setCrawlProgress('');
      }, 3000);
    }
  };

  const handleAddKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    const currentKeywords = profile.keywords ? profile.keywords.split(',').map(k => k.trim()) : [];
    if (!currentKeywords.includes(newKeyword.trim())) {
      const updatedKeywords = [...currentKeywords, newKeyword.trim()].join(', ');
      setProfile({ ...profile, keywords: updatedKeywords });
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (keyword: string) => {
    const updatedKeywords = profile.keywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k !== keyword)
      .join(', ');
    setProfile({ ...profile, keywords: updatedKeywords });
  };

  const getFavicon = (url: string) => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F7] text-[#4A443F] selection:bg-[#93C5FD]/30 selection:text-[#2D3A29]">
      <div className="flex">
        {/* Static Left Navigation */}
        <aside className="w-72 h-screen fixed left-0 top-0 bg-white border-r border-[#E8E4DE] flex flex-col z-50">
          <div className="p-8">
            <div className="flex items-center gap-3 mb-12">
              <button 
                onClick={() => setIsZenMode(!isZenMode)}
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 ${isZenMode ? 'bg-[#93C5FD] text-white shadow-[#93C5FD]/20 rotate-180' : 'bg-[#2D3A29] text-[#93C5FD] shadow-[#2D3A29]/20'}`}
                title={isZenMode ? "Disable Zen Mode" : "Enable Zen Mode"}
              >
                {isZenMode ? <Waves size={20} /> : <Briefcase size={20} />}
              </button>
              <h1 className="font-serif italic text-2xl text-[#2D3A29] tracking-tight">Work Scout</h1>
            </div>
            
            <nav className="space-y-2">
              {[
                { id: 'new', icon: Sparkles, label: 'New' },
                { id: 'past', icon: History, label: 'Past' },
                { id: 'approved', icon: ThumbsUp, label: 'Approved' },
                { id: 'applied', icon: PenLine, label: 'Applied' },
                { id: 'rejected', icon: ThumbsDown, label: 'Rejected' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as Tab)}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group ${
                    activeTab === tab.id 
                      ? 'bg-[#93C5FD]/10 text-[#2D3A29] shadow-sm ring-1 ring-[#93C5FD]/20' 
                      : 'hover:bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'
                  }`}
                >
                  <tab.icon size={20} className={activeTab === tab.id ? 'text-[#93C5FD]' : 'group-hover:text-[#93C5FD] transition-colors'} />
                  <span className="font-bold text-sm uppercase tracking-widest">{tab.label}</span>
                  {activeTab === tab.id && <ChevronRight size={14} className="ml-auto opacity-40" />}
                </button>
              ))}
            </nav>


          </div>

          <div className="mt-auto p-8 border-t border-[#E8E4DE] space-y-2">
            <button
              onClick={() => setActiveTab('sources')}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group ${
                activeTab === 'sources' 
                  ? 'bg-[#93C5FD]/10 text-[#2D3A29] shadow-sm ring-1 ring-[#93C5FD]/20' 
                  : 'hover:bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'
              }`}
            >
              <Globe size={20} className={activeTab === 'sources' ? 'text-[#93C5FD]' : 'group-hover:text-[#93C5FD] transition-colors'} />
              <span className="font-bold text-sm uppercase tracking-widest">Sources</span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group ${
                activeTab === 'settings' 
                  ? 'bg-[#93C5FD]/10 text-[#2D3A29] shadow-sm ring-1 ring-[#93C5FD]/20' 
                  : 'hover:bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'
              }`}
            >
              <Settings2 size={20} className={activeTab === 'settings' ? 'text-[#93C5FD]' : 'group-hover:text-[#93C5FD] transition-colors'} />
              <span className="font-bold text-sm uppercase tracking-widest">Settings</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 ml-72 min-h-screen flex flex-col">
          <header className="h-24 bg-white/40 backdrop-blur-md border-b border-[#E8E4DE] flex items-center justify-between px-12 sticky top-0 z-40">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isCrawling ? 'bg-[#93C5FD] animate-pulse' : 'bg-[#E8E4DE]'}`} />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-40">
                    {isCrawling ? 'Scouting Active' : 'System Ready'}
                  </span>
                  {isCrawling && crawlProgress && (
                    <motion.span 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[9px] font-mono opacity-60 text-[#2D3A29] truncate max-w-[200px]"
                    >
                      {crawlProgress}
                    </motion.span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-6">
              <button 
                onClick={handleResetData}
                disabled={isResetting}
                className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-red-400/60 hover:text-red-500 transition-all hover:scale-105"
                title="Reset All Job Data"
              >
                <Trash2 size={14} />
                <span>Reset</span>
              </button>
              <button 
                onClick={handleManualCrawl}
                disabled={isCrawling}
                className={`btn-primary flex items-center gap-3 px-8 ${isCrawling ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isCrawling ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>Scouting...</span>
                  </>
                ) : (
                  <>
                    <Search size={18} />
                    <span>Start Scouting</span>
                  </>
                )}
              </button>
            </div>
          </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-12">
          <AnimatePresence mode="wait">
            {activeTab === 'settings' ? (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12"
              >
                {/* Profile Settings */}
                <div className="space-y-8">
                  <div>
                    <h2 className="font-serif italic text-3xl text-[#2D3A29]">Your Profile</h2>
                    <p className="text-sm opacity-60">Help the scout find the right fit for you.</p>
                  </div>
                  <form onSubmit={handleSaveProfile} className="space-y-6">
                    <div className="space-y-2">
                      <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">Search Mode</label>
                      <div className="bg-[#F7F3EF] p-1 rounded-2xl flex gap-1">
                        <button
                          type="button"
                          onClick={() => setProfile({ ...profile, search_mode: 'strict' })}
                          className={`flex-1 py-2 px-4 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                            profile.search_mode === 'strict' 
                              ? 'bg-white text-[#2D3A29] shadow-sm' 
                              : 'text-[#4A443F]/40 hover:text-[#4A443F]'
                          }`}
                        >
                          Strict
                        </button>
                        <button
                          type="button"
                          onClick={() => setProfile({ ...profile, search_mode: 'discovery' })}
                          className={`flex-1 py-2 px-4 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                            profile.search_mode === 'discovery' 
                              ? 'bg-white text-[#2D3A29] shadow-sm' 
                              : 'text-[#4A443F]/40 hover:text-[#4A443F]'
                          }`}
                        >
                          Discovery
                        </button>
                      </div>
                      <p className="text-[10px] opacity-40 mt-1 italic">
                        {profile.search_mode === 'strict' 
                          ? "Strictly matches keywords + location + salary." 
                          : "Uses LinkedIn profile to semantically discover relevant roles."}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">Keywords</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                            <input 
                              type="text" 
                              placeholder="Add keyword (e.g. Data Engineer)"
                              className="input-field pl-12"
                              value={newKeyword}
                              onChange={e => setNewKeyword(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddKeyword(e)}
                            />
                          </div>
                          <button 
                            type="button"
                            onClick={handleAddKeyword}
                            className="p-3 rounded-xl bg-[#93C5FD] text-white hover:bg-[#60A5FA] transition-all"
                          >
                            <Plus size={20} />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {profile.keywords && profile.keywords.split(',').map(k => k.trim()).filter(k => k).map((keyword, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-[#F7F3EF] border border-[#E8E4DE] px-3 py-1.5 rounded-full">
                              <span className="text-xs font-medium text-[#4A443F]">{keyword}</span>
                              <button 
                                type="button"
                                onClick={() => handleRemoveKeyword(keyword)}
                                className="text-[#4A443F]/40 hover:text-red-500 transition-colors"
                              >
                                <Plus size={14} className="rotate-45" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">Location</label>
                      <div className="relative">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                        <input 
                          type="text" 
                          placeholder="Remote, London, UK..."
                          className="input-field pl-12"
                          value={profile.location}
                          onChange={e => setProfile({...profile, location: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">LinkedIn</label>
                      <div className="relative">
                        <Linkedin className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                        <input 
                          type="url" 
                          placeholder="https://linkedin.com/..."
                          className="input-field pl-12"
                          value={profile.linkedin_url}
                          onChange={e => setProfile({...profile, linkedin_url: e.target.value})}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">Min Salary</label>
                      <div className="relative">
                        <Coins className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                        <select 
                          className="input-field pl-12 appearance-none pr-10"
                          value={profile.min_salary || 30000}
                          onChange={(e) => setProfile({ ...profile, min_salary: parseInt(e.target.value) })}
                        >
                          {Array.from({ length: 25 }, (_, i) => 30000 + i * 5000).map(val => (
                            <option key={val} value={val}>£{val.toLocaleString()}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none" size={16} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="font-sans text-[11px] uppercase tracking-widest font-bold opacity-40">Crawl Interval (Days)</label>
                      <div className="relative">
                        <History className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20" size={18} />
                        <input 
                          type="number" 
                          min="1"
                          max="30"
                          className="input-field pl-12"
                          value={profile.crawl_interval || 3}
                          onChange={(e) => setProfile({ ...profile, crawl_interval: parseInt(e.target.value) || 1 })}
                        />
                      </div>
                      <p className="text-[10px] opacity-40 mt-1 italic">
                        Wait at least this many days before re-checking a source.
                      </p>
                    </div>
                    <button type="submit" disabled={isSaving} className="btn-primary w-full">
                      {isSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </form>
                </div>

                {/* Source Settings */}
                <div className="space-y-8">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="font-serif italic text-3xl text-[#2D3A29]">Crawl Sources</h2>
                      <p className="text-sm opacity-60">Websites the scout should monitor.</p>
                    </div>
                    <button 
                      onClick={() => !isImporting && sourceFileInputRef.current?.click()}
                      className={`text-[10px] uppercase tracking-widest font-bold transition-opacity flex items-center gap-2 ${isImporting ? 'text-[#93C5FD]' : 'opacity-40 hover:opacity-100'}`}
                      disabled={isImporting}
                    >
                      {isImporting ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>{importStatus}</span>
                        </>
                      ) : (
                        <>
                          <FileText size={14} />
                          <span>{importStatus || 'Bulk Upload (CSV)'}</span>
                        </>
                      )}
                      <input 
                        type="file" 
                        ref={sourceFileInputRef} 
                        className="hidden" 
                        accept=".csv" 
                        onChange={handleBulkSourceUpload} 
                      />
                    </button>
                  </div>
                  <form onSubmit={handleAddSource} className="space-y-4">
                    <input 
                      type="text" 
                      placeholder="Site Name (e.g. Saga Careers)"
                      className="input-field"
                      value={newSourceName}
                      onChange={e => setNewSourceName(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <input 
                        type="url" 
                        placeholder="Job page URL"
                        required
                        className="input-field"
                        value={newSourceUrl}
                        onChange={e => setNewSourceUrl(e.target.value)}
                      />
                      <button type="submit" disabled={isAddingSource} className="bg-[#93C5FD] text-white p-3 rounded-xl hover:bg-[#60A5FA] transition-all">
                        <Plus size={20} />
                      </button>
                    </div>
                  </form>
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-30 mb-4">Newly Added</h3>
                      <div className="space-y-3">
                        {sources.slice(0, 4).map(source => (
                          <div key={source.id} className={`pastel-card p-4 flex justify-between items-center group ${source.is_broken ? 'border-red-200 bg-red-50/30' : ''}`}>
                            <div className="flex items-center gap-3">
                              <img src={getFavicon(source.url) || ''} className="w-4 h-4 rounded-sm" alt="" />
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold">{source.name}</p>
                                  {!!source.is_broken && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[8px] font-bold uppercase tracking-widest bg-red-500 text-white px-1.5 py-0.5 rounded flex items-center gap-1">
                                        <AlertCircle size={8} /> Broken
                                      </span>
                                      <button 
                                        onClick={() => setSourceEditModal({
                                          isOpen: true,
                                          sourceId: source.id,
                                          name: source.name,
                                          url: source.url
                                        })}
                                        className="text-[8px] font-bold uppercase tracking-widest text-[#93C5FD] hover:underline"
                                      >
                                        Fix
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono opacity-40 truncate max-w-[180px]">{source.url}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <a 
                                href={source.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[#4A443F]/40 hover:text-[#93C5FD] transition-all p-2 hover:bg-[#93C5FD]/10 rounded-lg"
                                title="Visit Site"
                              >
                                <ArrowUpRight size={16} />
                              </a>
                              <button 
                                onClick={() => setSourceEditModal({
                                  isOpen: true,
                                  sourceId: source.id,
                                  name: source.name,
                                  url: source.url
                                })}
                                className="text-[#4A443F]/40 hover:text-[#93C5FD] transition-all p-2 hover:bg-[#93C5FD]/10 rounded-lg"
                                title="Edit Source"
                              >
                                <PenLine size={16} />
                              </button>
                              <button 
                                onClick={() => handleDeleteSource(source.id)} 
                                className={`text-red-400 transition-all p-2 hover:bg-red-50 rounded-lg ${source.is_broken ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                title="Delete Source"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {sources.length > 3 && (
                        <button 
                          onClick={() => setActiveTab('sources')}
                          className="mt-4 text-[10px] uppercase tracking-widest font-bold text-[#93C5FD] hover:underline flex items-center gap-2"
                        >
                          <span>View All {sources.length} Sources</span>
                          <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'sources' ? (
              <motion.div 
                key="sources"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-7xl mx-auto"
              >
                <div className="flex justify-between items-end mb-8">
                  <div>
                    <h2 className="font-serif italic text-5xl text-[#2D3A29]">All Crawl Sources</h2>
                    <p className="text-sm opacity-60 mt-2">The full list of websites your scout monitors for opportunities.</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <button 
                      onClick={handleClearSources}
                      className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-red-400/60 hover:text-red-500 transition-all hover:scale-105"
                    >
                      <Trash2 size={14} />
                      <span>Clear All</span>
                    </button>
                    <button 
                      onClick={handleExportSources}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
                    >
                      <Download size={14} />
                      <span>Export (CSV)</span>
                    </button>
                  </div>
                </div>

                {/* Source Health Dashboard */}
                <div className="grid grid-cols-1 gap-6 mb-12">
                  <div className="pastel-card p-4 flex items-center justify-around">
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1">Total</p>
                      <p className="text-xl font-serif italic text-[#2D3A29]">{sources.length}</p>
                    </div>
                    <div className="w-px h-6 bg-[#E8E4DE]" />
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1">Broken</p>
                      <p className="text-xl font-serif italic text-red-400">{sources.filter(s => s.is_broken).length}</p>
                    </div>
                    <div className="w-px h-6 bg-[#E8E4DE]" />
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1">Skipped</p>
                      <p className="text-xl font-serif italic text-[#93C5FD]">{lastCrawlReport?.sourcesSkipped || 0}</p>
                    </div>
                    <div className="w-px h-6 bg-[#E8E4DE]" />
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1">Crawled</p>
                      <p className="text-xl font-serif italic text-emerald-500">{lastCrawlReport?.sourcesChecked || 0}</p>
                    </div>
                    <div className="w-px h-6 bg-[#E8E4DE]" />
                    <div className="text-center">
                      <p className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1">Last Crawled</p>
                      <p className="text-xl font-serif italic text-[#2D3A29]">
                        {(() => {
                          const latest = sources.reduce((acc, s) => {
                            if (!s.last_crawled) return acc;
                            const d = new Date(s.last_crawled);
                            return !acc || d > acc ? d : acc;
                          }, null as Date | null);
                          return latest ? latest.toLocaleDateString() : 'Never';
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-8">
                  <button 
                    onClick={() => setSourceSort('latest')}
                    className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full transition-all ${sourceSort === 'latest' ? 'bg-[#93C5FD] text-white' : 'bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'}`}
                  >
                    Latest Addition
                  </button>
                  <button 
                    onClick={() => setSourceSort('alpha')}
                    className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full transition-all ${sourceSort === 'alpha' ? 'bg-[#93C5FD] text-white' : 'bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'}`}
                  >
                    Alphabetical
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[...sources].sort((a, b) => {
                    if (sourceSort === 'alpha') return a.name.localeCompare(b.name);
                    return b.id - a.id;
                  }).map(source => (
                    <div key={source.id} className={`pastel-card p-6 flex justify-between items-start group hover:shadow-md transition-all ${source.is_broken ? 'border-red-200 bg-red-50/30' : ''}`}>
                      <div className="flex items-start gap-4 overflow-hidden">
                        <div className="mt-1">
                          <img src={getFavicon(source.url) || ''} className="w-5 h-5 rounded-sm shadow-sm" alt="" />
                        </div>
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-2">
                            <p className="text-lg font-bold text-[#2D3A29] truncate">{source.name}</p>
                          </div>
                          <p className="text-xs font-mono opacity-40 truncate mt-1">{source.url}</p>
                          
                          {!!source.is_broken && (
                            <div className="mt-3 flex items-center gap-2 text-red-500">
                              <AlertCircle size={14} />
                              <p className="text-[10px] font-medium italic truncate">
                                {source.last_error || 'Connection failed'}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <a 
                          href={source.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-[#4A443F]/40 hover:text-[#93C5FD] transition-all p-2 hover:bg-[#93C5FD]/10 rounded-lg"
                        >
                          <ArrowUpRight size={18} />
                        </a>
                        <button 
                          onClick={() => setSourceEditModal({
                            isOpen: true,
                            sourceId: source.id,
                            name: source.name,
                            url: source.url
                          })}
                          className="text-[#4A443F]/40 hover:text-[#93C5FD] transition-all p-2 hover:bg-[#93C5FD]/10 rounded-lg"
                          title="Edit Source"
                        >
                          <PenLine size={18} />
                        </button>
                        <button 
                          onClick={() => handleDeleteSource(source.id)} 
                          className={`text-red-400 transition-all p-2 hover:bg-red-50 rounded-lg ${source.is_broken ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-5xl mx-auto"
              >
                <div className="flex justify-between items-end mb-12">
                  <div>
                    <h2 className="font-serif italic text-5xl text-[#2D3A29] capitalize">{activeTab} Jobs</h2>
                    <div className="flex items-center gap-3 mt-4">
                      <p className="text-sm opacity-60">
                        {activeTab === 'new' && "Freshly discovered opportunities just for you."}
                        {activeTab === 'past' && "Jobs from previous scouting sessions."}
                        {activeTab === 'approved' && "Opportunities you've given a thumbs up."}
                        {activeTab === 'applied' && "Jobs you've already applied for."}
                        {activeTab === 'rejected' && "Jobs that didn't quite hit the mark."}
                      </p>
                      {activeTab === 'new' && profile.keywords && (
                        <div className="flex items-center gap-2 bg-[#93C5FD]/10 px-3 py-1 rounded-full border border-[#93C5FD]/20">
                          <Search size={12} className="text-[#93C5FD]" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#93C5FD]">{profile.keywords}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-widest opacity-40 font-bold">
                    {jobs.length} Results
                  </div>
                </div>

                <div className="space-y-12">
                  {/* Primary Results */}
                  <div className="space-y-6">
                    {jobs.length === 0 ? (
                      <div className="py-24 text-center">
                        <div className="opacity-20">
                          <Briefcase size={64} className="mx-auto mb-6" />
                          <p className="font-serif italic text-2xl">The scout is resting.</p>
                        </div>
                        
                        {lastCrawlReport && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-12 max-w-lg mx-auto p-8 rounded-3xl bg-[#F7F3EF]/50 border border-[#E8E4DE] text-left"
                          >
                            <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-40 mb-6 flex items-center gap-2">
                              <Zap size={12} className="text-[#93C5FD]" />
                              Last Scout Report
                            </h4>
                            
                            <div className="space-y-4">
                              <p className="text-sm leading-relaxed text-[#4A443F]/80">
                                Last scout checked <span className="font-bold text-[#2D3A29]">{lastCrawlReport.sourcesChecked} sources</span>. 
                                {lastCrawlReport.sourcesUnreachable.length > 0 && (
                                  <> {lastCrawlReport.sourcesUnreachable.length} were unreachable (<span className="italic">{lastCrawlReport.sourcesUnreachable.join(', ')}</span>).</>
                                )}
                                {lastCrawlReport.sourcesWithNoMatches > 0 && (
                                  <> {lastCrawlReport.sourcesWithNoMatches} returned content but had no keyword matches.</>
                                )}
                                {lastCrawlReport.sourcesSkipped > 0 && (
                                  <> {lastCrawlReport.sourcesSkipped} {lastCrawlReport.sourcesSkipped === 1 ? 'was' : 'were'} skipped (checked recently).</>
                                )}
                              </p>
                              
                              <div className="pt-4 border-t border-[#E8E4DE] flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">New Jobs Found</span>
                                <span className="text-lg font-serif italic text-[#2D3A29]">{lastCrawlReport.newJobsFound}</span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    ) : (
                      jobs.map((job, index) => (
                        <motion.div 
                          key={job.id}
                          ref={el => jobRefs.current[job.id] = el}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => setSelectedIndex(index)}
                          className={`pastel-card p-8 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-start transition-all duration-300 ${selectedIndex === index ? 'ring-2 ring-[#93C5FD] shadow-xl scale-[1.01]' : 'hover:scale-[1.005]'}`}
                        >
                          <div className="space-y-4">
                            <div className="flex items-center gap-4">
                              <img src={getFavicon(job.link) || getFavicon(job.source_url) || ''} className="w-4 h-4 rounded-sm shadow-sm border border-[#E8E4DE]" alt="" />
                              <div>
                                <div className="flex items-center gap-3">
                                  <h3 className="font-bold text-2xl tracking-tight text-[#2D3A29]">{job.title}</h3>
                                  {!!job.is_broken && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[9px] font-bold uppercase tracking-widest bg-red-500 text-white px-2 py-0.5 rounded-md flex items-center gap-1">
                                        <AlertCircle size={10} /> Broken Link
                                      </span>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingJobId(job.id);
                                          setNewJobLink(job.link);
                                        }}
                                        className="text-[9px] font-bold uppercase tracking-widest text-[#93C5FD] hover:underline"
                                      >
                                        Update Link
                                      </button>
                                    </div>
                                  )}
                                </div>
                                {editingJobId === job.id && (
                                  <div className="mt-2 flex gap-2" onClick={e => e.stopPropagation()}>
                                    <input 
                                      type="url" 
                                      className="input-field py-1 text-xs flex-1"
                                      value={newJobLink}
                                      onChange={e => setNewJobLink(e.target.value)}
                                      placeholder="Paste new job link..."
                                      autoFocus
                                    />
                                    <button 
                                      onClick={() => handleUpdateJobLink(job.id)}
                                      className="px-3 py-1 bg-[#93C5FD] text-white rounded-lg text-[10px] font-bold uppercase tracking-widest"
                                    >
                                      Save
                                    </button>
                                    <button 
                                      onClick={() => setEditingJobId(null)}
                                      className="px-3 py-1 bg-[#F7F3EF] text-[#4A443F]/40 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                                <div className="flex items-center gap-4 mt-1 font-sans text-xs font-medium opacity-50">
                                  <span className="flex items-center gap-1.5"><Home size={14} className="text-[#93C5FD]" /> {job.company}</span>
                                  <span className="flex items-center gap-1.5"><MapPin size={14} className="text-[#93C5FD]" /> {job.location}</span>
                                  <span className="flex items-center gap-1.5"><Coins size={14} className="text-[#93C5FD]" /> {job.salary || 'Unknown'}</span>
                                </div>
                              </div>
                            </div>
                            
                            <p className="text-[#4A443F]/80 leading-relaxed text-sm max-w-3xl">{job.description}</p>
                            <div className="flex items-center gap-3 pt-2">
                              <a 
                                href={job.link} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="btn-primary flex items-center gap-2"
                              >
                                <span>View Listing</span>
                                <ArrowUpRight size={16} />
                              </a>
                              <button 
                                onClick={() => handleUpdateJobStatus(job.id, 'approved')}
                                className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-[#93C5FD]/10 hover:border-[#93C5FD] ${job.status === 'approved' ? 'bg-[#93C5FD] text-white border-[#93C5FD]' : 'text-[#4A443F]/40'}`}
                              >
                                <ThumbsUp size={20} />
                              </button>
                              <button 
                                onClick={() => handleUpdateJobStatus(job.id, 'rejected')}
                                className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-[#C3A0A0]/10 hover:border-[#C3A0A0] ${job.status === 'rejected' ? 'bg-[#C3A0A0] text-white border-[#C3A0A0]' : 'text-[#4A443F]/40'}`}
                              >
                                <ThumbsDown size={20} />
                              </button>
                              <button 
                                onClick={() => handleUpdateJobStatus(job.id, 'applied')}
                                className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-[#93C5FD]/10 hover:border-[#93C5FD] ${job.status === 'applied' ? 'bg-[#93C5FD] text-white border-[#93C5FD]' : 'text-[#4A443F]/40'}`}
                                title="Mark as Applied"
                              >
                                <PenLine size={20} />
                              </button>
                            </div>
                          </div>
                          <div className="hidden md:block text-right">
                            <p className="font-mono text-[9px] uppercase tracking-widest opacity-30 font-bold">Source</p>
                            <p className="text-[10px] opacity-40 truncate max-w-[150px] font-medium">{new URL(job.source_url).hostname}</p>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="bg-white/40 border-t border-[#E8E4DE] p-4 flex justify-between items-center">
        <div className="font-mono text-[9px] uppercase tracking-widest opacity-30 font-bold">
          © 2026 Let's Go To Work • Handcrafted for a peaceful search
        </div>
        <div className="flex gap-6">
          <a href="#" className="font-mono text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity font-bold">Privacy</a>
          <a href="#" className="font-mono text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity font-bold">Terms</a>
        </div>
      </footer>
    </main>
  </div>

  {/* Custom Modal */}
      <AnimatePresence>
        {modal?.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModal(null)}
              className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-[#E8E4DE] overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className={`p-3 rounded-2xl ${modal.type === 'confirm' ? 'bg-amber-50 text-amber-500' : 'bg-[#93C5FD]/10 text-[#93C5FD]'}`}>
                    <AlertCircle size={24} />
                  </div>
                  <h3 className="text-2xl font-bold text-[#2D3A29] tracking-tight">{modal.title}</h3>
                </div>
                <p className="text-[#4A443F]/70 leading-relaxed mb-8">
                  {modal.message}
                </p>
                <div className="flex gap-3">
                  {modal.type === 'confirm' ? (
                    <>
                      <button 
                        onClick={() => setModal(null)}
                        className="flex-1 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => {
                          modal.onConfirm?.();
                          setModal(null);
                        }}
                        className="flex-1 px-6 py-3 bg-[#2D3A29] text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-[#3D4A39] transition-colors shadow-lg shadow-[#2D3A29]/10"
                      >
                        Confirm
                      </button>
                    </>
                  ) : (
                    <button 
                      onClick={() => setModal(null)}
                      className="w-full px-6 py-3 bg-[#2D3A29] text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-[#3D4A39] transition-colors shadow-lg shadow-[#2D3A29]/10"
                    >
                      Got it
                    </button>
                  )}
                </div>
              </div>
              <button 
                onClick={() => setModal(null)}
                className="absolute top-6 right-6 p-2 text-[#4A443F]/20 hover:text-[#4A443F]/60 transition-colors"
              >
                <X size={20} />
              </button>
            </motion.div>
          </div>
        )}

        {sourceEditModal?.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSourceEditModal(null)}
              className="absolute inset-0 bg-black/10 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#E8E4DE] overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-[#93C5FD]/10 text-[#93C5FD]">
                    <PenLine size={18} />
                  </div>
                  <h3 className="text-lg font-bold text-[#2D3A29]">Edit Source</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1 block">Agency Name</label>
                    <input 
                      type="text"
                      value={sourceEditModal.name}
                      onChange={(e) => setSourceEditModal({...sourceEditModal, name: e.target.value})}
                      className="w-full p-3 bg-[#F8F7F4] border border-[#E8E4DE] rounded-xl text-sm focus:outline-none focus:border-[#93C5FD] transition-colors"
                      placeholder="Agency Name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold opacity-30 mb-1 block">URL</label>
                    <input 
                      type="url"
                      value={sourceEditModal.url}
                      onChange={(e) => setSourceEditModal({...sourceEditModal, url: e.target.value})}
                      className="w-full p-3 bg-[#F8F7F4] border border-[#E8E4DE] rounded-xl text-sm font-mono focus:outline-none focus:border-[#93C5FD] transition-colors"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-6">
                  <button 
                    onClick={() => setSourceEditModal(null)}
                    className="flex-1 px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={() => handleUpdateSource(sourceEditModal.sourceId, sourceEditModal.url, sourceEditModal.name)}
                    className="flex-1 px-4 py-2 bg-[#93C5FD] text-white rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-[#60A5FA] transition-colors shadow-md shadow-[#93C5FD]/10"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
              <button 
                onClick={() => setSourceEditModal(null)}
                className="absolute top-4 right-4 p-2 text-[#4A443F]/20 hover:text-[#4A443F]/60 transition-colors"
              >
                <X size={16} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
