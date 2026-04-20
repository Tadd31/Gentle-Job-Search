import React, { useState, useEffect, useRef, Component } from 'react';
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
  PlusCircle,
  Menu,
  ArrowUpRight,
  ThumbsUp,
  ThumbsDown,
  History,
  Sparkles,
  Settings2,
  Trash2,
  Download,
  Upload,
  Waves,
  AlertCircle,
  Info,
  X,
  Check,
  ChevronDown,
  Coins,
  Zap,
  HelpCircle,
  LogOut,
  LogIn,
  User as UserIcon,
  Loader2,
  Puzzle,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import Papa from 'papaparse';
import confetti from 'canvas-confetti';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout, 
  onAuthStateChanged, 
  User, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocFromServer,
  Timestamp,
  writeBatch,
  handleFirestoreError,
  OperationType
} from './firebase';

const ZEN_SOUND = 'https://actions.google.com/sounds/v1/water/water_lapping_wind.ogg';

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if ((this as any).state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse((this as any).state.errorInfo || '{}');
        if (parsed.error) displayMessage = `Permission Denied: ${parsed.operationType} on ${parsed.path}`;
      } catch (e) {
        displayMessage = (this as any).state.errorInfo || displayMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FBF9F7] p-8">
          <div className="pastel-card p-8 max-w-md text-center">
            <AlertCircle size={48} className="text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-serif italic mb-4">Application Error</h2>
            <p className="text-sm opacity-60 mb-6">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="btn-primary w-full"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  link: string;
  found_at: any; // Firestore Timestamp or ISO string
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
}

interface Source {
  id: string;
  url: string;
  name: string;
  is_broken?: boolean;
  last_error?: string;
  last_crawled?: any; // Firestore Timestamp or ISO string
  last_checked?: any; // Firestore Timestamp or ISO string
  created_at?: any; // Firestore Timestamp or ISO string
  jobs_found?: number;
}

interface LastCrawlReport {
  sourcesChecked: number;
  sourcesUnreachable: string[];
  sourcesSkipped: number;
  sourcesWithNoMatches: number;
  newJobsFound: number;
}

type Tab = 'new' | 'past' | 'approved' | 'applied' | 'rejected' | 'settings' | 'sources' | 'extension';

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [profile, setProfile] = useState<Profile>({
    keywords: '',
    location: '',
    linkedin_url: '',
    search_mode: 'strict'
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
  const [debugModal, setDebugModal] = useState<{ isOpen: boolean; text: string; sourceName: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [sourceSort, setSourceSort] = useState<'latest' | 'alpha'>('latest');
  const [jobSort, setJobSort] = useState<'latest' | 'alpha'>('latest');
  const [isZenMode, setIsZenMode] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [sourceEditModal, setSourceEditModal] = useState<{
    isOpen: boolean;
    sourceId: string;
    name: string;
    url: string;
  } | null>(null);
  const [newJobLink, setNewJobLink] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [lastAction, setLastAction] = useState<{ id: string; status: Job['status'] } | null>(null);
  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'confirm' | 'alert';
    title: string;
    message: string;
    onConfirm?: () => void;
  } | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');

  const checkDbConnection = async () => {
    setDbConnectionStatus('checking');
    try {
      const testRef = doc(db, 'test', 'connection');
      await getDocFromServer(testRef);
      setDbConnectionStatus('connected');
    } catch (err: any) {
      console.error('DB Connection check failed:', err);
      // If it's just a "not found" error, it still means we reached the server
      if (err.code === 'not-found' || !err.message.includes('offline')) {
        setDbConnectionStatus('connected');
      } else {
        setDbConnectionStatus('error');
      }
    }
  };

  useEffect(() => {
    if (isAuthReady) {
      checkDbConnection();
    }
  }, [isAuthReady]);

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        showAlert('Login Cancelled', 'The login popup was closed before completion. Please try again.');
      } else if (err.code === 'auth/popup-blocked') {
        showAlert('Popup Blocked', 'The login popup was blocked by your browser. Please allow popups for this site and try again.');
      } else if (err.code === 'auth/unauthorized-domain') {
        const currentDomain = window.location.hostname;
        showAlert('Domain Not Authorized', `The domain "${currentDomain}" is not authorized in the Firebase console. Please add it to the "Authorized domains" list in Firebase Authentication settings.`);
      } else {
        showAlert('Login Error', err.message || 'An unexpected error occurred during login.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      
      // Sync session with server for browser extension
      fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(u ? {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName
        } : {})
      }).catch(err => console.error('Failed to sync session:', err));
    });
    return () => unsubscribe();
  }, []);

  // Firestore Real-time Listeners
  useEffect(() => {
    if (!user || !isAuthReady) {
      if (isAuthReady) {
        setProfile({
          keywords: '',
          location: '',
          linkedin_url: '',
          search_mode: 'strict'
        });
        setSources([]);
        setJobs([]);
      }
      return;
    }

    const userId = user.uid;

    // Profile Listener
    const profileRef = doc(db, 'users', userId, 'profile', 'config');
    const unsubscribeProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as Profile);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${userId}/profile/config`));

    // Sources Listener
    const sourcesRef = collection(db, 'users', userId, 'sources');
    const unsubscribeSources = onSnapshot(sourcesRef, (snapshot) => {
      const sourcesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Source));
      setSources(sourcesData);
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${userId}/sources`));

    // Jobs Listener
    const jobsRef = collection(db, 'users', userId, 'jobs');
    let jobsQuery = query(jobsRef);
    
    if (activeTab !== 'settings' && activeTab !== 'sources' && activeTab !== 'extension') {
      jobsQuery = query(jobsRef, where('status', '==', activeTab));
    }

    const unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Job));
      setJobs(jobsData);
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${userId}/jobs`));

    return () => {
      unsubscribeProfile();
      unsubscribeSources();
      unsubscribeJobs();
    };
  }, [user, isAuthReady, activeTab]);

  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => setLastAction(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  const showAlert = (title: string, message: string) => {
    setModal({ isOpen: true, type: 'alert', title, message });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ isOpen: true, type: 'confirm', title, message, onConfirm });
  };

  const zenAudioRef = useRef<HTMLAudioElement | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);

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
    if (!user) return showAlert('Login Required', 'Please log in to save your profile.');
    setIsSaving(true);
    try {
      const profileRef = doc(db, 'users', user.uid, 'profile', 'config');
      await setDoc(profileRef, profile);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/profile/config`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetData = () => {
    if (!user) return;
    showConfirm(
      'Reset All Data',
      'Are you sure you want to reset all job search data? This will permanently delete all discovered jobs from your database, but keep your profile and sources. This action cannot be undone.',
      async () => {
        setIsResetting(true);
        try {
          const jobsRef = collection(db, 'users', user.uid, 'jobs');
          const snapshot = await getDocs(jobsRef);
          const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
          
          // Also reset source crawl timestamps so user can re-test immediately
          const sourcesRef = collection(db, 'users', user.uid, 'sources');
          const sourcesSnapshot = await getDocs(sourcesRef);
          const updatePromises = sourcesSnapshot.docs.map(d => updateDoc(d.ref, {
            last_crawled: null,
            jobs_found: 0,
            is_broken: false,
            last_error: null
          }));
          await Promise.all(updatePromises);
          
          // Reset local state
          setJobs([]);
          setSelectedIndex(-1);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          
          showAlert('Success', 'Job data and crawl history have been reset.');
        } catch (err) {
          console.error(err);
          handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/jobs`);
        } finally {
          setIsResetting(false);
        }
      }
    );
  };

  const handleTestSource = async (source: Source) => {
    if (!user) return;
    setCrawlProgress(`Testing ${source.name || source.url}...`);
    try {
      const contentRes = await fetchWithTimeout(`/api/fetch-content?url=${encodeURIComponent(source.url)}`);
      let text = '';
      let error = '';
      let jobsCount = 0;
      
      if (!contentRes.ok) {
        try {
          const errJson = await contentRes.json();
          error = errJson.error || contentRes.statusText;
        } catch (e) {
          error = contentRes.statusText;
        }
        console.error(`Test fetch failed for ${source.url}: ${contentRes.status}`, error);
      } else {
        const data = await contentRes.json();
        text = data.text;
        jobsCount = data.jobs?.length || 0;
        
        if (data.detectedBoard) {
          showAlert('API Detected', `This site uses the ${data.detectedBoard} API. Scouting will be extra reliable!`);
        }
        
        console.log(`Test fetch success for ${source.url}:`, { textLength: text?.length || 0, jobsCount });
      }

      if (!text && jobsCount === 0) {
        const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
        await updateDoc(sourceRef, { 
          is_broken: true, 
          last_error: error || 'No job content found (page might be empty or blocked)',
          last_crawled: Timestamp.now()
        });
      }

      setDebugModal({
        isOpen: true,
        text: text || `ERROR: ${error || 'No job content found on this page.'}${jobsCount > 0 ? ` (But found ${jobsCount} structured jobs)` : ''}`,
        sourceName: source.name || source.url
      });
    } catch (err: any) {
      console.error(err);
      setDebugModal({
        isOpen: true,
        text: `CRITICAL ERROR: ${err.message}`,
        sourceName: source.name || source.url
      });
    } finally {
      setCrawlProgress('');
    }
  };

  const handleUpdateJobLink = async (jobId: string) => {
    if (!newJobLink || !user) return;
    try {
      const jobRef = doc(db, 'users', user.uid, 'jobs', jobId);
      await updateDoc(jobRef, { link: newJobLink });
      setEditingJobId(null);
      setNewJobLink('');
      showAlert('Success', 'Job link updated.');
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/jobs/${jobId}`);
    }
  };

  const [faviconErrors, setFaviconErrors] = useState<Record<string, boolean>>({});

  const isScoutedInLast24h = (lastCrawled: any) => {
    if (!lastCrawled) return false;
    const date = lastCrawled instanceof Timestamp ? lastCrawled.toDate() : new Date(lastCrawled);
    const now = new Date();
    return (now.getTime() - date.getTime()) < 24 * 60 * 60 * 1000;
  };

  const handleFaviconError = (url: string) => {
    setFaviconErrors(prev => ({ ...prev, [url]: true }));
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

          if (url && isUrl(url) && user) {
            // Check for duplicates
            const isDuplicate = sources.some(s => s.url.toLowerCase() === url.toLowerCase());
            if (isDuplicate) continue;

            try {
              const sourcesRef = collection(db, 'users', user.uid, 'sources');
              await setDoc(doc(sourcesRef), { 
                url, 
                name, 
                jobs_found: 0,
                created_at: Timestamp.now()
              });
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

  const handleAddSource = async (e?: React.FormEvent, manualUrl?: string, manualName?: string) => {
    if (e) e.preventDefault();
    
    const url = manualUrl || newSourceUrl;
    const name = manualName || newSourceName;

    if (!url || !user) return showAlert('Login Required', 'Please log in to add sources.');
    setIsAddingSource(true);
    try {
      const sourcesRef = collection(db, 'users', user.uid, 'sources');
      await setDoc(doc(sourcesRef), { 
        url: url, 
        name: name || url, 
        jobs_found: 0,
        created_at: Timestamp.now()
      });
      if (!manualUrl) {
        setNewSourceUrl('');
        setNewSourceName('');
      }
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/sources`);
    } finally {
      setIsAddingSource(false);
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!user) return;
    try {
      const sourceRef = doc(db, 'users', user.uid, 'sources', id);
      await deleteDoc(sourceRef);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/sources/${id}`);
    }
  };

  const handleUpdateSource = async (id: string, url: string, name: string) => {
    if (!user) return;
    try {
      const sourceRef = doc(db, 'users', user.uid, 'sources', id);
      await updateDoc(sourceRef, { url, name });
      setSourceEditModal(null);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/sources/${id}`);
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
    if (!user) return;
    showConfirm(
      'Clear All Sources',
      'Are you sure you want to delete ALL crawl sources? This cannot be undone.',
      async () => {
        try {
          const sourcesRef = collection(db, 'users', user.uid, 'sources');
          const snapshot = await getDocs(sourcesRef);
          const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
          await Promise.all(deletePromises);
          showAlert('Success', 'All sources have been removed.');
        } catch (err) {
          console.error('Error in handleClearSources:', err);
          handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/sources`);
        }
      }
    );
  };

  const handleUpdateJobStatus = async (id: string, status: Job['status']) => {
    if (!user) return;
    setUpdatingJobId(id);
    setLastAction({ id, status });
    
    // Clear selection if the updating job is the selected one
    setSelectedIndex(prev => {
      if (prev >= 0 && jobs[prev]?.id === id) return -1;
      return prev;
    });

    try {
      if (status === 'applied') {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#93C5FD', '#1D3557', '#FFFFFF']
        });
      }

      const jobRef = doc(db, 'users', user.uid, 'jobs', id);
      await updateDoc(jobRef, { status });
    } catch (err) {
      console.error('[Firestore] Error updating job status:', err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/jobs/${id}`);
    } finally {
      // Small delay to ensure the animation has a chance to start before the spinner disappears
      // though the removal is triggered by the snapshot, not this state.
      setTimeout(() => setUpdatingJobId(null), 100);
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
    if (isCrawling || !user) return;
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

      // Move existing 'new' jobs to 'past'
      const jobsRef = collection(db, 'users', user.uid, 'jobs');
      const newJobsQuery = query(jobsRef, where('status', '==', 'new'));
      const newJobsSnapshot = await getDocs(newJobsQuery);
      
      if (!newJobsSnapshot.empty) {
        setCrawlProgress('Archiving previous results...');
        const batch = writeBatch(db);
        newJobsSnapshot.docs.forEach(jobDoc => {
          batch.update(jobDoc.ref, { status: 'past' });
        });
        await batch.commit();
      }

      // Deduplication: Fetch existing job URLs from Firestore
      const allJobsSnapshot = await getDocs(jobsRef);
      const existingUrls = new Set(allJobsSnapshot.docs.map(d => d.data().link));

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
        sourcesChecked++;
        const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
        await updateDoc(sourceRef, { last_checked: Timestamp.now() });

        try {
          // Incremental Crawling Check: Skip if crawled in last 24 hours
          if (source.last_crawled) {
            const now = new Date();
            const lastCrawledDate = source.last_crawled instanceof Timestamp 
              ? source.last_crawled.toDate() 
              : new Date(source.last_crawled);
            const diffInHours = (now.getTime() - lastCrawledDate.getTime()) / (1000 * 60 * 60);
            
            if (diffInHours < 24) {
              sourcesSkipped++;
              continue;
            }
          }

          let extractedJobs: any[] = [];
          let text = '';

          // 1. TRY SPECIALIZED BOARD APIs FIRST
          const fetchSpecializedBoardJobs = async () => {
            // Greenhouse Detection
            const ghMatch = source.url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
            const isVML = source.url.toLowerCase().includes('vml') || (source.name || '').toLowerCase().includes('vml');
            if (ghMatch || isVML) {
              const boardId = ghMatch ? ghMatch[1] : 'vml';
              setCrawlProgress(`Fetching Greenhouse API for ${boardId}...`);
              try {
                const res = await fetch(`/api/greenhouse-jobs?boardId=${boardId}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.jobs) return data.jobs.map((j: any) => ({
                    id: `gh-${j.id}`,
                    title: j.title,
                    company: j.company_name || (j.metadata?.find((m: any) => m.name === 'Brand')?.value ? `${source.name} (${j.metadata.find((m: any) => m.name === 'Brand').value})` : source.name),
                    location: j.location?.name || 'Unknown',
                    link: j.absolute_url,
                    description: `Found via Greenhouse API. ${j.metadata?.find((m: any) => m.name === 'Capability')?.value || ''}`,
                    salary: 'Unknown',
                    seniority: 'Unknown'
                  }));
                }
              } catch (e) {}
            }

            // Publicis Detection
            if (source.url.includes('careers.publicisgroupe.com')) {
              setCrawlProgress(`Fetching Publicis Groupe Unified API...`);
              try {
                const res = await fetch(`/api/publicis-jobs?limit=4000`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.jobs) return data.jobs.map((j: any) => {
                    const jd = j.data;
                    const agencyTag = jd.tags8?.[0] || jd.tags9?.[0] || jd.tags2?.[0];
                    return {
                      id: `pub-${jd.req_id}`,
                      title: jd.title,
                      company: agencyTag ? agencyTag.split(' - ')[0] : 'Publicis Groupe',
                      location: jd.full_location || jd.location_name || 'Global',
                      link: jd.apply_url || jd.canonical_url,
                      description: `Found via Publicis Unified Portal. ${jd.employment_type || ''}`,
                      salary: 'Unknown',
                      seniority: jd.tags5?.[0] || 'Unknown'
                    };
                  });
                }
              } catch (e) {}
            }

            // SmartRecruiters Detection
            const srMatch = source.url.match(/(?:careers|jobs)\.smartrecruiters\.com\/([^/?#]+)/);
            const isSRReferral = !source.url.includes('droga5.com') && source.url.includes('droga5');
            const finalSrMatch = srMatch || (isSRReferral ? [null, 'droga5'] : null);
            if (finalSrMatch) {
              const companyId = finalSrMatch[1];
              setCrawlProgress(`Fetching SmartRecruiters API for ${companyId}...`);
              try {
                const res = await fetch(`/api/smartrecruiters-jobs?company=${companyId}`);
                if (res.ok) {
                  const data = await res.json();
                  if (data.content) return data.content.map((j: any) => ({
                    id: `sr-${j.id}`,
                    title: j.name,
                    company: source.name || 'Droga5',
                    location: j.location?.city || j.location?.region || 'Unknown',
                    link: `https://jobs.smartrecruiters.com/${companyId}/${j.id}`,
                    description: `Found via SmartRecruiters API. ${j.typeOfEmployment?.label || ''}`,
                    salary: 'Unknown',
                    seniority: 'Unknown'
                  }));
                }
              } catch (e) {}
            }
            return [];
          };

          extractedJobs = await fetchSpecializedBoardJobs();

          // 2. FALLBACK TO CONTENT CRAWLING + AI EXTRACTION
          if (extractedJobs.length === 0) {
            setCrawlProgress(`Fetching content from ${source.name || source.url}...`);
            const contentRes = await fetchWithTimeout(`/api/fetch-content?url=${encodeURIComponent(source.url)}`);
            
            if (!contentRes.ok) {
              let errorDetail = contentRes.statusText;
              try {
                const errJson = await contentRes.json();
                if (errJson.error) errorDetail = errJson.error;
              } catch (e) {}

              sourcesUnreachable.push(source.name || source.url);
              const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
              await updateDoc(sourceRef, { 
                is_broken: true, 
                last_error: errorDetail || 'Fetch failed',
                last_crawled: Timestamp.now()
              });
              continue;
            }
            
            const data = await contentRes.json();
            text = data.text;
            
            if (data.jobs && Array.isArray(data.jobs)) {
              // If we have structured jobs, we can use them directly!
              // But we should still filter them by the user's keywords if in strict mode.
              const keywords = profile.keywords?.toLowerCase().split(',').map(k => k.trim()).filter(Boolean) || [];
              if (profile.search_mode === 'strict' && keywords.length > 0) {
                extractedJobs = data.jobs.filter((j: any) => {
                  const title = j.title.toLowerCase();
                  const desc = j.description.toLowerCase();
                  return keywords.some(k => title.includes(k) || desc.includes(k));
                });
              } else {
                extractedJobs = data.jobs;
              }
            }

            if (extractedJobs.length === 0 && (!text || text.length < 200)) {
              sourcesUnreachable.push(source.name || source.url);
              // Mark as broken if content is sparse
              const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
              await updateDoc(sourceRef, { 
                is_broken: true,
                last_error: 'No job content found (page might be empty or blocked)',
                last_crawled: Timestamp.now() 
              });
              continue;
            }

            if (source.is_broken) {
              const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
              await updateDoc(sourceRef, { is_broken: false, last_error: null });
            }

            if (extractedJobs.length === 0) {
              setCrawlProgress(`Analyzing jobs for ${source.name || source.url}...`);
              
              const keywordsText = profile.keywords?.trim() || 'No specific keywords (show all relevant jobs)';
              const locationText = profile.location?.trim() || 'Any location';
              const minSalaryText = profile.min_salary ? `£${profile.min_salary.toLocaleString()}` : 'No minimum salary';

              const modeInstructions = profile.search_mode === 'strict' 
                ? (profile.keywords?.trim() 
                    ? `STRICT MODE: Only include jobs that explicitly match at least one of the keywords: ${profile.keywords}.`
                    : `STRICT MODE: No keywords specified. Include all jobs found in the text.`)
                : `DISCOVERY MODE: Use keywords (${profile.keywords || 'None'}) AND the user's LinkedIn profile (${profile.linkedin_url || 'Not provided'}) to semantically discover relevant roles.`;

              const approvedContext = jobs.filter(j => j.status === 'approved').slice(0, 5).map(j => `- ${j.title} at ${j.company}`).join('\n');
              const rejectedContext = jobs.filter(j => j.status === 'rejected').slice(0, 5).map(j => `- ${j.title} at ${j.company}`).join('\n');

              const prompt = `
                Extract job listings from the following text. 
                
                USER CONTEXT:
                - Keywords: ${keywordsText}
                - Location: ${locationText}
                - Minimum Salary: ${minSalaryText}
                
                LEARNING FROM HISTORY:
                The user has APPROVED these types of jobs:
                ${approvedContext || 'None yet'}
                
                The user has REJECTED these types of jobs:
                ${rejectedContext || 'None yet'}
                
                SEARCH MODE:
                ${modeInstructions}
                
                CRITICAL FILTERING CRITERIA:
                1. Be thorough but precise. 
                2. KEYWORD MATCHING: ${profile.keywords?.trim() ? 'Only include jobs matching the keywords.' : 'Include all jobs found.'}
                3. LOCATION PRECISION: ${profile.location?.trim() ? `The user is looking for jobs in ${profile.location}. Be flexible with sub-regions.` : 'No location filter specified.'}
                4. SALARY EXTRACTION: Look for salary information.
                5. SENIORITY EXTRACTION: Look for seniority level.
                6. MATCHING: Even if a job title doesn't exactly match a keyword, if it's a similar role (e.g., "Application Developer" for "Software Engineer"), include it.
                7. NO MATCHES: If no jobs match the criteria, return an empty array [].

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
              `;

              const result = await generateWithRetry(prompt);
              const resultText = result.text || '[]';
              
              // Robust JSON extraction
              try {
                const jsonMatch = resultText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                  extractedJobs = JSON.parse(jsonMatch[0]);
                } else {
                  extractedJobs = JSON.parse(resultText);
                }
              } catch (e) {
                console.error('Failed to parse Gemini JSON:', resultText);
                extractedJobs = [];
              }
            }
          }
          
          // Deduplication by URL
          const newJobs = extractedJobs.filter(job => !existingUrls.has(job.link));
          
          if (newJobs.length > 0) {
            totalNewJobs += newJobs.length;
            setCrawlProgress(`Saving ${newJobs.length} new jobs from ${source.name || source.url}...`);
            
            const jobsRef = collection(db, 'users', user.uid, 'jobs');
            const savePromises = newJobs.map(job => {
              const jobDoc = doc(jobsRef);
              existingUrls.add(job.link); // Prevent duplicates in the same crawl
              return setDoc(jobDoc, {
                ...job,
                status: 'new',
                source_url: source.url,
                found_at: Timestamp.now()
              });
            });
            await Promise.all(savePromises);
          } else {
            sourcesWithNoMatches++;
          }

          // Update Source Stats
          const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
          await updateDoc(sourceRef, { 
            last_crawled: Timestamp.now(), 
            jobs_found: (source.jobs_found || 0) + newJobs.length 
          });
        } catch (sourceErr: any) {
          console.error(`Error crawling ${source.name || source.url}:`, sourceErr);
          sourcesUnreachable.push(source.name || source.url);
          const sourceRef = doc(db, 'users', user.uid, 'sources', source.id);
          await updateDoc(sourceRef, { 
            is_broken: true, 
            last_error: sourceErr.message || 'Crawl failed',
            last_crawled: Timestamp.now()
          });
        }
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
    <div className="min-h-screen bg-[#FBF9F7] text-[#4A443F] selection:bg-[#93C5FD]/30 selection:text-[#2D3A29] overflow-x-hidden">
      {/* Mobile Sidebar Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[55] lg:hidden"
          />
        )}
      </AnimatePresence>

      <div className="flex">
        {/* Slide-in Navigation */}
        <aside className={`w-72 h-screen fixed left-0 top-0 bg-white border-r border-[#E8E4DE] flex flex-col z-[60] transition-transform duration-500 ease-[0.32,0.72,0,1] lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
          <div className="p-8 flex flex-col h-full">
            <div className="flex flex-col gap-8 mb-12">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsZenMode(!isZenMode)}
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg transition-all duration-500 ${isZenMode ? 'bg-[#93C5FD] text-white shadow-[#93C5FD]/20 rotate-180' : 'bg-[#2D3A29] text-[#93C5FD] shadow-[#2D3A29]/20'}`}
                    title={isZenMode ? "Disable Zen Mode" : "Enable Zen Mode"}
                  >
                    {isZenMode ? <Waves size={20} /> : <Briefcase size={20} />}
                  </button>
                  <h1 className="font-serif italic text-2xl text-[#2D3A29] tracking-tight">Work Scout</h1>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="lg:hidden p-2 hover:bg-gray-100 rounded-xl text-gray-400"
                >
                  <X size={20} />
                </button>
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
                    onClick={() => {
                      setActiveTab(tab.id as Tab);
                      if (window.innerWidth < 1024) setIsSidebarOpen(false);
                    }}
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

            <div className="mt-auto space-y-2">
              <button
                onClick={() => {
                  setActiveTab('sources');
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
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
                onClick={() => {
                  setActiveTab('extension');
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group ${
                  activeTab === 'extension' 
                    ? 'bg-[#93C5FD]/10 text-[#2D3A29] shadow-sm ring-1 ring-[#93C5FD]/20' 
                    : 'hover:bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'
                }`}
              >
                <Puzzle size={20} className={activeTab === 'extension' ? 'text-[#93C5FD]' : 'group-hover:text-[#93C5FD] transition-colors'} />
                <span className="font-bold text-sm uppercase tracking-widest">Extension</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('settings');
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group ${
                  activeTab === 'settings' 
                    ? 'bg-[#93C5FD]/10 text-[#2D3A29] shadow-sm ring-1 ring-[#93C5FD]/20' 
                    : 'hover:bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'
                }`}
              >
                <UserIcon size={20} className={activeTab === 'settings' ? 'text-[#93C5FD]' : 'group-hover:text-[#93C5FD] transition-colors'} />
                <span className="font-bold text-sm uppercase tracking-widest">Your Profile</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 lg:ml-72 min-h-screen flex flex-col w-full relative">
          <header className="h-20 lg:h-24 bg-white/80 backdrop-blur-xl border-b border-[#E8E4DE] flex items-center justify-between px-4 lg:px-12 fixed top-0 left-0 right-0 lg:left-72 z-40">
            <div className="flex items-center gap-4 lg:gap-6">
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 hover:bg-gray-100 rounded-xl text-[#2D3A29]"
              >
                <Menu size={24} />
              </button>
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isCrawling ? 'bg-[#93C5FD] animate-pulse' : 'bg-[#E8E4DE]'}`} />
                <div className="flex flex-col">
                  <span className="text-[9px] lg:text-[10px] font-bold uppercase tracking-[0.2em] opacity-40">
                    {isCrawling ? 'Scouting Active' : 'System Ready'}
                  </span>
                  {isCrawling && crawlProgress && (
                    <motion.span 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`text-[8px] lg:text-[9px] font-mono opacity-60 text-[#2D3A29] truncate max-w-[120px] lg:max-w-[200px] ${crawlProgress.includes('complete') ? 'cursor-pointer hover:text-[#93C5FD] underline' : ''}`}
                      onClick={async () => {
                        if (crawlProgress.includes('complete') && user) {
                          const sourcesRef = collection(db, 'users', user.uid, 'sources');
                          const sourcesSnapshot = await getDocs(sourcesRef);
                          const updatePromises = sourcesSnapshot.docs.map(d => updateDoc(d.ref, {
                            last_crawled: null,
                            jobs_found: 0,
                            is_broken: false,
                            last_error: null
                          }));
                          await Promise.all(updatePromises);
                          showAlert('Ready', 'Crawl history cleared. You can scout again immediately.');
                        }
                      }}
                    >
                      {crawlProgress}
                    </motion.span>
                  )}
                </div>
                {!isCrawling && user && (
                  <button
                    onClick={handleResetData}
                    disabled={isResetting}
                    className="ml-4 px-3 py-1.5 rounded-full border border-red-100 bg-red-50/30 text-[9px] font-bold uppercase tracking-widest text-red-400 hover:bg-red-50 hover:text-red-500 transition-all duration-300 flex items-center gap-1.5 group"
                  >
                    <Trash2 size={10} className="group-hover:scale-110 transition-transform" /> 
                    {isResetting ? 'Clearing...' : 'Clear All Jobs'}
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2 lg:gap-6">
              {user ? (
                <div className="flex items-center gap-2 lg:gap-4">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#2D3A29]">
                      {user.displayName?.split(' ')[0] || 'User'}
                    </span>
                    <button 
                      onClick={logout}
                      className="text-[9px] font-bold uppercase tracking-widest text-red-400 hover:text-red-500 transition-colors flex items-center gap-1"
                    >
                      <LogOut size={10} /> Logout
                    </button>
                  </div>
                  {user.photoURL ? (
                    <img src={user.photoURL} className="w-8 h-8 rounded-full border border-[#E8E4DE]" alt="" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#F7F3EF] flex items-center justify-center border border-[#E8E4DE]">
                      <UserIcon size={16} className="opacity-20" />
                    </div>
                  )}
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className={`flex items-center gap-2 text-[10px] lg:text-[11px] uppercase tracking-widest font-bold text-[#2D3A29] hover:text-[#93C5FD] transition-all ${isLoggingIn ? 'opacity-70 cursor-wait' : ''}`}
                >
                  <div className="relative flex items-center justify-center">
                    {isLoggingIn ? (
                      <RefreshCw size={14} className="animate-spin text-[#93C5FD]" />
                    ) : (
                      <LogIn size={14} />
                    )}
                  </div>
                  <span className={isLoggingIn ? 'text-[#93C5FD]' : 'hidden sm:inline'}>
                    {isLoggingIn ? '...' : 'Login'}
                  </span>
                </button>
              )}
              
              {/* Sync VML button removed as requested */}
              
              <button 
                onClick={handleManualCrawl}
                disabled={isCrawling || !user}
                className={`btn-primary flex items-center gap-2 lg:gap-3 px-4 lg:px-8 py-2.5 lg:py-3 text-[10px] lg:text-xs ${isCrawling || !user ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isCrawling ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span className="hidden sm:inline">Scouting...</span>
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    <span className="hidden sm:inline">Start Scouting</span>
                    <span className="sm:hidden">Start</span>
                  </>
                )}
              </button>
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 p-4 lg:p-12 pt-24 lg:pt-36">
          <AnimatePresence mode="wait">
            {activeTab === 'extension' ? (
              <motion.div 
                key="extension"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-3xl mx-auto"
              >
                <div className="space-y-12">
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-[#93C5FD]/10 rounded-[2.5rem] flex items-center justify-center mx-auto text-[#93C5FD] shadow-sm">
                      <Puzzle size={40} />
                    </div>
                    <h2 className="font-serif italic text-5xl text-[#2D3A29]">The Scout Clipper</h2>
                    <p className="text-lg opacity-60 max-w-xl mx-auto">Clip job boards directly from your browser and let the scout do the rest.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="pastel-card p-8 space-y-6">
                      <h3 className="font-bold text-[#2D3A29] flex items-center gap-2">
                        <Download className="w-5 h-5 text-[#93C5FD]" />
                        Get the Extension
                      </h3>
                      <p className="text-sm text-[#4A443F]/70 leading-relaxed">
                        Download the extension package and install it in your Chrome-based browser to start clipping sources instantly.
                      </p>
                      <a 
                        href="/api/extension/download" 
                        className="btn-primary w-full py-4 flex items-center justify-center gap-3 no-underline"
                      >
                        <Download size={18} />
                        Download ZIP (v1.0.0)
                      </a>
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                        <p className="text-[10px] text-amber-700 leading-relaxed">
                          <strong>Note:</strong> This is a Work-in-Progress (Beta). It may not be 100% reliable yet as we refine the connection logic.
                        </p>
                      </div>
                    </div>

                    <div className="pastel-card p-8 space-y-6">
                      <h3 className="font-bold text-[#2D3A29] flex items-center gap-2">
                        <Info className="w-5 h-5 text-[#93C5FD]" />
                        How to Install
                      </h3>
                      <ol className="space-y-4 text-sm text-[#4A443F]/70 list-decimal list-inside">
                        <li>Download and <strong>unzip</strong> the file.</li>
                        <li>Open Chrome and go to <code className="bg-[#F7F3EF] px-1.5 py-0.5 rounded">chrome://extensions</code></li>
                        <li>Enable <strong>Developer Mode</strong> (top right).</li>
                        <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
                        <li>Pin the 🌊 icon to your toolbar!</li>
                      </ol>
                      <div className="p-4 bg-[#93C5FD]/5 border border-[#93C5FD]/10 rounded-2xl">
                        <p className="text-[10px] text-[#2D3A29]/60 leading-relaxed">
                          <strong>Pro Tip:</strong> Make sure you are logged in to <a href={window.location.origin} target="_blank" className="text-[#93C5FD] underline">{window.location.host}</a> before using the extension. If you just logged in, you might need to close and reopen the extension popup.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pastel-card p-8 space-y-4">
                    <h3 className="font-bold text-[#2D3A29]">How it Works</h3>
                    <p className="text-sm text-[#4A443F]/70 leading-relaxed">
                      The Scout Clipper lives in your browser toolbar. When you find a company's career page or a job board you want to monitor, simply open the extension and click <strong>"Clip to Scout"</strong>. 
                    </p>
                    <p className="text-sm text-[#4A443F]/70 leading-relaxed">
                      The URL will be instantly added to your <strong>Sources</strong> list. The next time the scout runs its crawl, it will include this new site in its search for opportunities.
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-2xl mx-auto"
              >
                {!user && (
                  <div className="mb-12 p-6 bg-[#93C5FD]/10 border border-[#93C5FD]/20 rounded-3xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-[#93C5FD] shadow-sm">
                      <LogIn size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#2D3A29]">Sign in to save your progress</h3>
                      <p className="text-xs text-[#4A443F]/60">Logging in ensures your profile and job preferences are synced across devices.</p>
                    </div>
                    <button 
                      onClick={handleLogin}
                      className="ml-auto btn-primary py-2 px-6 text-[10px]"
                    >
                      Login Now
                    </button>
                  </div>
                )}

                {/* Profile Settings */}
                <div className="space-y-8 pastel-card p-12">
                  <div>
                    <h2 className="font-serif italic text-4xl text-[#2D3A29]">Your Profile</h2>
                    <p className="text-sm opacity-60 mt-2">Help the scout find the right fit for you.</p>
                  </div>
                  <form onSubmit={handleSaveProfile} className="space-y-8">
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
                    <button type="submit" disabled={isSaving} className="btn-primary w-full py-4 text-sm">
                      {isSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </form>
                </div>

                {/* Connection Status Indicator */}
                <div className="mt-8 pastel-card p-8 border-t-4 border-[#93C5FD]">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-serif italic text-2xl text-[#2D3A29]">Connection Status</h3>
                      <p className="text-[10px] opacity-40">Verify your app's link to Firebase.</p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                      dbConnectionStatus === 'connected' ? 'bg-green-100 text-green-600' :
                      dbConnectionStatus === 'error' ? 'bg-red-100 text-red-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        dbConnectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                        dbConnectionStatus === 'error' ? 'bg-red-500' :
                        'bg-gray-500'
                      }`} />
                      {dbConnectionStatus === 'connected' ? 'Connected' : 
                       dbConnectionStatus === 'error' ? 'Offline' : 'Checking...'}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="p-4 bg-[#F7F3EF] rounded-2xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Project ID</span>
                        <span className="text-xs font-mono text-[#2D3A29]">gen-lang-client-0402391668</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Database ID</span>
                        <span className="text-xs font-mono text-[#2D3A29]">ai-studio-d6cd8c71-688c-4179-8f94-be58ac11ea83</span>
                      </div>
                      <div className="pt-3 border-t border-[#E8E4DE]">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Your User ID (UID)</span>
                          {user && (
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(user.uid);
                                confetti({ particleCount: 30, spread: 50, origin: { y: 0.8 }, colors: ['#93C5FD'] });
                              }}
                              className="text-[9px] text-[#93C5FD] hover:underline font-bold uppercase"
                            >
                              Copy UID
                            </button>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-[#2D3A29] break-all bg-white/50 p-2 rounded-lg border border-[#E8E4DE]">
                          {user ? user.uid : 'Not logged in'}
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] opacity-40 italic leading-relaxed">
                      If you don't see data in the Firebase Console, search for your <strong>User ID</strong> in the <strong>users</strong> collection. 
                      Firestore collections only appear in the console once they contain at least one document.
                    </p>

                    <button 
                      onClick={checkDbConnection}
                      className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-[#4A443F]/60 hover:text-[#4A443F] transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={12} className={dbConnectionStatus === 'checking' ? 'animate-spin' : ''} />
                      Refresh Connection
                    </button>
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
                      onClick={() => !isImporting && sourceFileInputRef.current?.click()}
                      className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold transition-opacity ${isImporting ? 'text-[#93C5FD]' : 'opacity-40 hover:opacity-100'}`}
                      disabled={isImporting}
                    >
                      {isImporting ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>{importStatus}</span>
                        </>
                      ) : (
                        <>
                          <Upload size={14} />
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
                    <button 
                      onClick={handleExportSources}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
                    >
                      <Download size={14} />
                      <span>Export (CSV)</span>
                    </button>
                    <button 
                      onClick={handleClearSources}
                      className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-bold text-red-400/60 hover:text-red-500 transition-all hover:scale-105"
                    >
                      <Trash2 size={14} />
                      <span>Clear All</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                  {/* Manual Entry */}
                  <div className="p-6 bg-[#F7F3EF] rounded-3xl border border-[#E8E4DE]">
                    <h3 className="text-sm font-bold text-[#2D3A29] mb-2 flex items-center gap-2">
                      <PlusCircle className="w-4 h-4 text-[#93C5FD]" />
                      Manual Entry
                    </h3>
                    <p className="text-xs text-[#4A443F]/60 mb-4 leading-relaxed">
                      Add a specific job board or career page URL manually to the scout's monitoring list.
                    </p>
                    <form onSubmit={handleAddSource} className="space-y-3">
                      <input 
                        type="text" 
                        placeholder="Site Name (e.g. Saga Careers)"
                        className="w-full p-3 text-sm border border-[#E8E4DE] rounded-xl focus:ring-2 focus:ring-[#93C5FD] outline-none bg-white"
                        value={newSourceName}
                        onChange={e => setNewSourceName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <input 
                          type="url" 
                          placeholder="Job page URL"
                          required
                          className="flex-1 p-3 text-sm border border-[#E8E4DE] rounded-xl focus:ring-2 focus:ring-[#93C5FD] outline-none bg-white"
                          value={newSourceUrl}
                          onChange={e => setNewSourceUrl(e.target.value)}
                        />
                        <button type="submit" disabled={isAddingSource} className="bg-[#93C5FD] text-white p-3 rounded-xl hover:bg-[#60A5FA] transition-all shadow-lg shadow-[#93C5FD]/20">
                          <Plus size={20} />
                        </button>
                      </div>
                    </form>
                  </div>
                  <div className="p-6 bg-green-50 rounded-3xl border border-green-100">
                    <h3 className="text-sm font-bold text-green-800 mb-2 flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      Quick Add Greenhouse Board
                    </h3>
                    <p className="text-xs text-green-700 mb-4 leading-relaxed">
                      Enter a Greenhouse Board ID to fetch jobs directly via API. This is the most reliable way to scout for jobs.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Board ID (e.g. wpp)"
                        className="flex-1 p-3 text-sm border border-green-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none bg-white"
                        id="gh-board-id-sources"
                      />
                      <button
                        onClick={() => {
                          const input = document.getElementById('gh-board-id-sources') as HTMLInputElement;
                          if (input && input.value) {
                            const boardId = input.value.trim();
                            handleAddSource(
                              undefined,
                              `https://boards.greenhouse.io/${boardId}`,
                              `Greenhouse: ${boardId}`
                            );
                            input.value = '';
                          }
                        }}
                        className="px-6 py-3 bg-green-600 text-white text-xs font-bold rounded-xl hover:bg-green-700 transition-colors shadow-lg shadow-green-600/20"
                      >
                        Add Board
                      </button>
                    </div>
                  </div>

                  {/* How-To Section */}
                  <div className="p-6 bg-[#93C5FD]/5 border border-[#93C5FD]/20 rounded-3xl">
                    <h3 className="text-sm font-bold text-[#2D3A29] mb-2 flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-[#93C5FD]" />
                      How to find a Board ID?
                    </h3>
                    <p className="text-xs text-[#4A443F]/60 leading-relaxed">
                      1. Go to the company's career page.<br/>
                      2. Look for a URL like <code className="bg-[#93C5FD]/10 px-1 rounded">boards.greenhouse.io/companyname</code>.<br/>
                      3. The <code className="bg-[#93C5FD]/10 px-1 rounded">companyname</code> part is your Board ID.
                    </p>
                  </div>
                </div>

                {/* Crawler Tip */}
                <div className="mb-8 p-6 bg-[#93C5FD]/5 border border-[#93C5FD]/20 rounded-3xl flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#93C5FD]/10 flex items-center justify-center text-[#93C5FD] shrink-0">
                    <Info size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#2D3A29] text-sm mb-1">Crawler Tip: Handling "Access Denied" (403)</h4>
                    <p className="text-xs text-[#4A443F]/60 leading-relaxed">
                      If you see "Access Denied" or "403", it means the website's bot protection is blocking the scout. 
                      <strong>Solution:</strong> Try finding the direct job board URL (e.g. on Greenhouse or Workday). 
                      You can also use the <strong>"Quick Add"</strong> tool above for Greenhouse boards.
                    </p>
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
                      <p className="text-xl font-serif italic text-red-400">{sources.filter(s => s.is_broken && !isScoutedInLast24h(s.last_crawled)).length}</p>
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
                            const d = s.last_crawled instanceof Timestamp ? s.last_crawled.toDate() : new Date(s.last_crawled);
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
                    if (sourceSort === 'alpha') return (a.name || '').localeCompare(b.name || '');
                    
                    const getTime = (s: Source) => {
                      const date = s.created_at || s.last_crawled;
                      if (!date) return 0;
                      if (typeof date.toMillis === 'function') return date.toMillis();
                      if (typeof date.toDate === 'function') return date.toDate().getTime();
                      if (date.seconds !== undefined) return date.seconds * 1000 + (date.nanoseconds || 0) / 1000000;
                      const d = new Date(date);
                      return isNaN(d.getTime()) ? 0 : d.getTime();
                    };
                    
                    return getTime(b) - getTime(a);
                  }).map(source => {
                      const recentlyScouted = isScoutedInLast24h(source.last_crawled);
                      return (
                        <div key={source.id} className={`pastel-card p-6 flex justify-between items-start group hover:shadow-md transition-all ${source.is_broken ? (recentlyScouted ? 'border-blue-200 bg-blue-50/30' : 'border-red-200 bg-red-50/30') : ''}`}>
                          <div className="flex items-start gap-4 overflow-hidden">
                            <div className="mt-1">
                              <img 
                                src={faviconErrors[source.url] ? `https://ui-avatars.com/api/?name=${encodeURIComponent(source.name || 'S')}&background=random` : getFavicon(source.url) || ''} 
                                onError={() => handleFaviconError(source.url)}
                                className="w-5 h-5 rounded-sm shadow-sm" 
                                alt="" 
                              />
                            </div>
                            <div className="overflow-hidden">
                              <div className="flex items-center gap-2">
                                <p className="text-lg font-bold text-[#2D3A29] truncate">{source.name}</p>
                                {source.url.includes('boards.greenhouse.io') && (
                                  <span className="text-[8px] font-bold uppercase tracking-widest bg-green-500 text-white px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
                                    <Globe size={8} /> API
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-mono opacity-40 truncate mt-1">{source.url}</p>
                              
                              <div className="mt-2 flex items-center gap-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">
                                  Last: {(() => {
                                    if (!source.last_crawled) return 'Never';
                                    const date = source.last_crawled instanceof Timestamp ? source.last_crawled.toDate() : new Date(source.last_crawled);
                                    const now = new Date();
                                    const isToday = date.toDateString() === now.toDateString();
                                    return isToday ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString();
                                  })()}
                                </p>
                                <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">
                                  Jobs: {source.jobs_found || 0}
                                </p>
                              </div>
                              
                              {!!source.is_broken && (
                                <div className="mt-3 flex items-center gap-2 text-red-500">
                                  <AlertCircle size={14} />
                                  <p className="text-[10px] font-medium italic leading-tight">
                                    {source.last_error || 'Connection failed'}
                                  </p>
                                </div>
                              )}
                              
                              {recentlyScouted && !source.is_broken && (
                                <div className="mt-3 flex items-center gap-2 text-emerald-500">
                                  <CheckCircle2 size={14} />
                                  <p className="text-[10px] font-bold uppercase tracking-widest leading-tight">
                                    Up to date
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
                          onClick={() => handleTestSource(source)}
                          className="text-[#4A443F]/40 hover:text-[#93C5FD] transition-all p-2 hover:bg-[#93C5FD]/10 rounded-lg"
                          title="Test Crawler"
                        >
                          <Eye size={18} />
                        </button>
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
                  )})}
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
                  <div className="flex items-center gap-4 mb-8">
                    <button 
                      onClick={() => setJobSort('latest')}
                      className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full transition-all ${jobSort === 'latest' ? 'bg-[#93C5FD] text-white' : 'bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'}`}
                    >
                      Latest Addition
                    </button>
                    <button 
                      onClick={() => setJobSort('alpha')}
                      className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full transition-all ${jobSort === 'alpha' ? 'bg-[#93C5FD] text-white' : 'bg-[#F7F3EF] text-[#4A443F]/40 hover:text-[#4A443F]'}`}
                    >
                      Alphabetical
                    </button>
                  </div>

                  <div className="space-y-6 relative min-h-[400px] overflow-hidden">
                    <AnimatePresence mode="popLayout">
                      {jobs.length > 0 ? (
                        jobs
                          .sort((a, b) => {
                            if (jobSort === 'alpha') return a.title.localeCompare(b.title);
                            
                            const getTime = (j: Job) => {
                              const date = j.found_at;
                              if (!date) return 0;
                              if (typeof date.toMillis === 'function') return date.toMillis();
                              if (typeof date.toDate === 'function') return date.toDate().getTime();
                              if (date.seconds !== undefined) return date.seconds * 1000 + (date.nanoseconds || 0) / 1000000;
                              const d = new Date(date);
                              return isNaN(d.getTime()) ? 0 : d.getTime();
                            };
                            
                            return getTime(b) - getTime(a);
                          })
                          .map((job, index) => (
                            <motion.div 
                              key={job.id}
                              layout
                              ref={el => jobRefs.current[job.id] = el}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ 
                                opacity: 1, 
                                y: 0,
                                scale: selectedIndex === index ? 1.01 : 1,
                                boxShadow: selectedIndex === index ? "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" : "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)"
                              }}
                              whileHover={{ scale: selectedIndex === index ? 1.01 : 1.005 }}
                              exit={{ 
                                opacity: 0, 
                                x: lastAction?.id === job.id ? 800 : 0,
                                scale: 0.9,
                                transition: { duration: 0.8, ease: [0.32, 0.72, 0, 1] } 
                              }}
                              transition={{ 
                                layout: { duration: 0.6 },
                                opacity: { duration: 0.4 },
                                y: { duration: 0.4 },
                                scale: { duration: 0.4 }
                              }}
                              onClick={() => setSelectedIndex(index)}
                              className={`pastel-card p-8 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-start ${
                                selectedIndex === index ? 'ring-2 ring-[#93C5FD]' : ''
                              } ${
                                lastAction?.id === job.id ? (
                                  lastAction.status === 'approved' ? 'bg-green-50/80 border-green-200' :
                                  lastAction.status === 'rejected' ? 'bg-red-50/80 border-red-200' :
                                  ''
                                ) : ''
                              }`}
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
                                      <span className="flex items-center gap-1.5 opacity-40">
                                        <History size={12} /> 
                                        {job.found_at instanceof Timestamp ? job.found_at.toDate().toLocaleDateString() : new Date(job.found_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                
                                <p className="text-[#4A443F]/80 leading-relaxed text-sm max-w-3xl">{job.description}</p>
                                
                                <div className="flex items-center gap-3 pt-2">
                                  <a 
                                    href={job.link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="btn-primary flex items-center gap-2"
                                  >
                                    <span>View Listing</span>
                                    <ArrowUpRight size={16} />
                                  </a>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => handleUpdateJobStatus(job.id, 'approved')}
                                      disabled={updatingJobId === job.id}
                                      className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-green-50 hover:border-green-500 ${job.status === 'approved' ? 'bg-green-500 text-white border-green-500' : 'text-[#4A443F]/40'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title="Approve"
                                    >
                                      <ThumbsUp size={20} />
                                    </button>
                                    <button 
                                      onClick={() => handleUpdateJobStatus(job.id, 'rejected')}
                                      disabled={updatingJobId === job.id}
                                      className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-red-50 hover:border-red-500 ${job.status === 'rejected' ? 'bg-red-500 text-white border-red-500' : 'text-[#4A443F]/40'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title="Reject"
                                    >
                                      <ThumbsDown size={20} />
                                    </button>
                                    <button 
                                      onClick={() => handleUpdateJobStatus(job.id, 'applied')}
                                      disabled={updatingJobId === job.id}
                                      className={`p-2.5 rounded-full border border-[#E8E4DE] transition-all hover:bg-blue-50 hover:border-blue-500 ${job.status === 'applied' ? 'bg-blue-500 text-white border-blue-500' : 'text-[#4A443F]/40'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title="Mark as Applied"
                                    >
                                      <PenLine size={20} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div className="hidden md:block text-right">
                                <p className="font-mono text-[9px] uppercase tracking-widest opacity-30 font-bold">Source</p>
                                <p className="text-[10px] opacity-40 truncate max-w-[150px] font-medium">{new URL(job.source_url).hostname}</p>
                              </div>
                            </motion.div>
                          ))
                      ) : (
                        <motion.div 
                          key="empty"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="py-24 text-center"
                        >
                          {sources.length === 0 && activeTab === 'new' ? (
                            <div className="max-w-md mx-auto text-left pastel-card p-10 bg-white/60">
                              <h3 className="text-2xl font-serif italic mb-6 text-[#2D3A29]">Getting Started</h3>
                              <div className="space-y-6">
                                <div className="flex gap-4">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${user ? 'bg-green-500/20 text-green-600' : 'bg-[#93C5FD]/20 text-[#93C5FD]'}`}>
                                    {user ? <Check size={16} /> : '1'}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#2D3A29]">Login to create your account</p>
                                    <p className="text-sm opacity-60">Click the <LogIn size={12} className="inline mx-1" /> icon in the header to sync your data.</p>
                                  </div>
                                </div>
                                <div className="flex gap-4">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${sources.length > 0 ? 'bg-green-500/20 text-green-600' : 'bg-[#93C5FD]/20 text-[#93C5FD]'}`}>
                                    {sources.length > 0 ? <Check size={16} /> : '2'}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#2D3A29]">Add your first source</p>
                                    <p className="text-sm opacity-60">Go to the <button onClick={() => setActiveTab('sources')} className="text-[#93C5FD] hover:underline font-bold">Sources</button> tab and add a career page URL.</p>
                                  </div>
                                </div>
                                <div className="flex gap-4">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${profile.keywords ? 'bg-green-500/20 text-green-600' : 'bg-[#93C5FD]/20 text-[#93C5FD]'}`}>
                                    {profile.keywords ? <Check size={16} /> : '3'}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#2D3A29]">Set your keywords</p>
                                    <p className="text-sm opacity-60">In <button onClick={() => setActiveTab('settings')} className="text-[#93C5FD] hover:underline font-bold">Settings</button>, add keywords like "Product Designer" or "React Developer".</p>
                                  </div>
                                </div>
                                <div className="flex gap-4">
                                  <div className="w-8 h-8 rounded-full bg-[#93C5FD]/20 text-[#93C5FD] flex items-center justify-center font-bold text-sm shrink-0">4</div>
                                  <div>
                                    <p className="font-bold text-[#2D3A29]">Start Scout</p>
                                    <p className="text-sm opacity-60">Click the <RefreshCw size={12} className="inline mx-1" /> icon in the header to find matching jobs.</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="opacity-20">
                              <Briefcase size={64} className="mx-auto mb-6" />
                              <p className="font-serif italic text-2xl">
                                {activeTab === 'approved' ? 'No approved jobs yet.' : 
                                 activeTab === 'applied' ? 'No applications tracked.' :
                                 activeTab === 'rejected' ? 'No rejected jobs.' :
                                 'The scout is resting.'}
                              </p>
                              <div className="mt-6">
                                {/* Buttons removed as requested */}
                              </div>
                            </div>
                          )}
                          
                          {lastCrawlReport && activeTab === 'new' && (
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
                                  Scout processed <span className="font-bold text-[#2D3A29]">{lastCrawlReport.sourcesChecked} {lastCrawlReport.sourcesChecked === 1 ? 'source' : 'sources'}</span>. 
                                  {lastCrawlReport.sourcesUnreachable.length > 0 && (
                                    <> {lastCrawlReport.sourcesUnreachable.length} {lastCrawlReport.sourcesUnreachable.length === 1 ? 'was' : 'were'} unreachable (<span className="italic">{lastCrawlReport.sourcesUnreachable.join(', ')}</span>).</>
                                  )}
                                  {lastCrawlReport.sourcesWithNoMatches > 0 && (
                                    <> {lastCrawlReport.sourcesWithNoMatches} {lastCrawlReport.sourcesWithNoMatches === 1 ? 'source' : 'sources'} returned content but had no new jobs matching your criteria.</>
                                  )}
                                  {lastCrawlReport.sourcesSkipped > 0 && (
                                    <> {lastCrawlReport.sourcesSkipped} {lastCrawlReport.sourcesSkipped === 1 ? 'was' : 'were'} skipped (checked recently).</>
                                  )}
                                </p>
                                
                                <div className="pt-4 border-t border-[#E8E4DE] flex items-center justify-between">
                                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">New Jobs Found</span>
                                  <span className="text-lg font-serif italic text-[#2D3A29]">{lastCrawlReport.newJobsFound}</span>
                                </div>
                                <div className="pt-4 flex justify-end">
                                  <button 
                                    onClick={async () => {
                                      if (!user) return;
                                      const sourcesRef = collection(db, 'users', user.uid, 'sources');
                                      const sourcesSnapshot = await getDocs(sourcesRef);
                                      const updatePromises = sourcesSnapshot.docs.map(d => updateDoc(d.ref, {
                                        last_crawled: null,
                                        jobs_found: 0,
                                        is_broken: false,
                                        last_error: null
                                      }));
                                      await Promise.all(updatePromises);
                                      setLastCrawlReport(prev => prev ? { ...prev, sourcesSkipped: 0 } : null);
                                      showAlert('History Cleared', 'You can now scout all sources again immediately.');
                                    }}
                                    className="text-[10px] uppercase tracking-widest font-bold text-[#93C5FD] hover:text-[#60A5FA] flex items-center gap-1.5 transition-colors"
                                  >
                                    <RefreshCw size={12} />
                                    Clear History to Re-test
                                  </button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="bg-white/40 border-t border-[#E8E4DE] p-4 flex justify-between items-center relative">
          <div className="font-mono text-[9px] uppercase tracking-widest opacity-30 font-bold">
            © 2026 Let's Go To Work • Handcrafted for a peaceful search
          </div>
          
          <div className="flex gap-6 items-center">
            <button 
              onClick={() => setShowShortcuts(!showShortcuts)}
              className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity font-bold bg-[#F7F3EF] px-3 py-1.5 rounded-lg"
            >
              <HelpCircle size={12} /> Keyboard Shortcuts
            </button>
            <a href="#" className="font-mono text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity font-bold">Privacy</a>
            <a href="#" className="font-mono text-[9px] uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity font-bold">Terms</a>
          </div>

          <AnimatePresence>
            {showShortcuts && (
              <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="absolute bottom-16 right-4 w-64 bg-white rounded-2xl shadow-2xl border border-[#E8E4DE] p-6 z-[60]"
              >
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#2D3A29]">Shortcuts</h4>
                  <button onClick={() => setShowShortcuts(false)} className="opacity-20 hover:opacity-100"><X size={14} /></button>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] opacity-40 uppercase tracking-widest">Approve</span>
                    <kbd className="px-2 py-1 bg-[#F7F3EF] rounded text-[10px] font-bold">J</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] opacity-40 uppercase tracking-widest">Reject</span>
                    <kbd className="px-2 py-1 bg-[#F7F3EF] rounded text-[10px] font-bold">K</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] opacity-40 uppercase tracking-widest">Applied</span>
                    <kbd className="px-2 py-1 bg-[#F7F3EF] rounded text-[10px] font-bold">L</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] opacity-40 uppercase tracking-widest">Open Link</span>
                    <kbd className="px-2 py-1 bg-[#F7F3EF] rounded text-[10px] font-bold">Enter</kbd>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] opacity-40 uppercase tracking-widest">Navigate</span>
                    <kbd className="px-2 py-1 bg-[#F7F3EF] rounded text-[10px] font-bold">↑ ↓</kbd>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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

        {/* Debug Modal */}
        {debugModal && debugModal.isOpen && (
          <div className="fixed inset-0 bg-[#2D3A29]/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-[40px] shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden border border-[#E8E4DE]"
            >
              <div className="p-8 border-b border-[#E8E4DE] flex justify-between items-center bg-[#FBF9F7]">
                <div>
                  <h3 className="font-serif italic text-3xl text-[#2D3A29]">Crawler Debug: {debugModal.sourceName}</h3>
                  <p className="text-xs opacity-40 mt-1 uppercase tracking-widest font-bold">Raw text extracted from the page</p>
                </div>
                <button onClick={() => setDebugModal(null)} className="p-2 hover:bg-[#E8E4DE] rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>
              <div className="p-8 overflow-y-auto flex-1 font-mono text-xs leading-relaxed bg-white whitespace-pre-wrap">
                {debugModal.text}
              </div>
              <div className="p-8 border-t border-[#E8E4DE] bg-[#FBF9F7] flex justify-end">
                <button 
                  onClick={() => setDebugModal(null)}
                  className="px-8 py-3 bg-[#2D3A29] text-white rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-[#1A2419] transition-all shadow-lg shadow-[#2D3A29]/20"
                >
                  Close
                </button>
              </div>
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
