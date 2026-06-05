import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { ImportModalComponent } from '../import-modal/import-modal.component';

interface DebateMessage {
  sender: string;
  message_text: string;
  negotiation_round: number;
}

interface EvaluationSession {
  id: number;
  tender_name: string;
  client_name: string;
  budget: number;
  timeline_months: number;
  industry: string;
  roster: string[];
  final_verdict: string;
  final_budget: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, ImportModalComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: []
})
export class DashboardComponent implements OnInit, AfterViewChecked {
  @ViewChild('chatScrollContainer') private chatScrollContainer!: ElementRef;

  // Session user details
  currentUser: any = null;
  profilePicFailed: boolean = false;

  // Form Inputs
  tenderName: string = '';
  clientName: string = '';
  budget: number = null as any;
  timelineMonths: number = null as any;
  industry: string = 'Healthcare';
  
  // Validation errors
  errors: { [key: string]: string } = {};

  isDarkMode: boolean = true;

  // Agent Roster Options
  agentsRoster = {
    techArchitect: true,
    riskAnalyst: true,
    opsManager: true,
    legal: true,
    resource: true,
    finance: true
  };

  validateField(field: string): void {
    if (field === 'tenderName') {
      const trimmed = (this.tenderName || '').trim();
      if (!trimmed) {
        this.errors['tenderName'] = 'Tender / Project Name is required.';
      } else if (trimmed.length < 3) {
        this.errors['tenderName'] = 'Tender Name must be at least 3 characters.';
      } else if (trimmed.length > 100) {
        this.errors['tenderName'] = 'Tender Name cannot exceed 100 characters.';
      } else {
        delete this.errors['tenderName'];
      }
    }

    if (field === 'clientName') {
      const trimmed = (this.clientName || '').trim();
      if (!trimmed) {
        this.errors['clientName'] = 'Client Name is required.';
      } else if (trimmed.length < 3) {
        this.errors['clientName'] = 'Client Name must be at least 3 characters.';
      } else if (trimmed.length > 100) {
        this.errors['clientName'] = 'Client Name cannot exceed 100 characters.';
      } else {
        delete this.errors['clientName'];
      }
    }

    if (field === 'budget') {
      if (this.budget === undefined || this.budget === null || (this.budget as any) === '') {
        this.errors['budget'] = 'Budget is required.';
      } else if (this.budget <= 0) {
        this.errors['budget'] = 'Budget must be greater than 0.';
      } else {
        delete this.errors['budget'];
      }
    }

    if (field === 'timelineMonths') {
      if (this.timelineMonths === undefined || this.timelineMonths === null || (this.timelineMonths as any) === '') {
        this.errors['timelineMonths'] = 'Timeline is required.';
      } else if (this.timelineMonths <= 0) {
        this.errors['timelineMonths'] = 'Timeline must be at least 1 month.';
      } else if (!Number.isInteger(this.timelineMonths)) {
        this.errors['timelineMonths'] = 'Timeline must be a whole number of months.';
      } else {
        delete this.errors['timelineMonths'];
      }
    }

    if (field === 'roster') {
      const activeCount = (this.agentsRoster.techArchitect ? 1 : 0) +
                          (this.agentsRoster.riskAnalyst ? 1 : 0) +
                          (this.agentsRoster.opsManager ? 1 : 0) +
                          (this.agentsRoster.legal ? 1 : 0) +
                          (this.agentsRoster.resource ? 1 : 0) +
                          (this.agentsRoster.finance ? 1 : 0);
      if (activeCount === 0) {
        this.errors['roster'] = 'Please select at least one agent to initiate evaluation.';
      } else {
        delete this.errors['roster'];
      }
    }
  }

  validateAll(): boolean {
    this.validateField('tenderName');
    this.validateField('clientName');
    this.validateField('budget');
    this.validateField('timelineMonths');
    this.validateField('roster');
    return Object.keys(this.errors).length === 0;
  }

  // Evaluation States
  activeSession: EvaluationSession | null = null;
  debateMessages: DebateMessage[] = [];
  currentTypingAgent: string | null = null;
  evaluating: boolean = false;
  activeTab: 'console' | 'history' | 'training' = 'console';
  agentConfigs: any = null;
  originalAgentConfigs: any = null;
  
  get isAgentConfigsChanged(): boolean {
    if (!this.agentConfigs || !this.originalAgentConfigs) return false;
    return JSON.stringify(this.agentConfigs) !== JSON.stringify(this.originalAgentConfigs);
  }

  isSidebarCollapsed: boolean = false;
  missionBriefing: string = '';
  verdictCollapsed: boolean = true;
  agentFlags: { [agent: string]: string } = {};

  // Agent Verdict Reason Overlay State
  selectedStanceAgent: string | null = null;
  selectedStanceStatus: string | null = null;
  selectedStanceReasons: string[] = [];

  // Historical sessions
  historyList: EvaluationSession[] = [];

  // Import modal
  showImportModal = false;

  // Toast notification
  toast: { message: string; type: 'success' | 'error' } | null = null;
  private toastTimeout: any = null;

  showToast(message: string, type: 'success' | 'error' = 'success'): void {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toast = { message, type };
    this.toastTimeout = setTimeout(() => this.dismissToast(), 3500);
  }

  dismissToast(): void {
    this.toast = null;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }
  
  backendUrl = 'http://localhost:3000';
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    const token = localStorage.getItem('token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
    }

    // Load Theme State
    const savedTheme = localStorage.getItem('theme');
    this.isDarkMode = savedTheme ? savedTheme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    const htmlEl = document.documentElement;
    if (this.isDarkMode) {
      htmlEl.classList.remove('light');
      htmlEl.classList.add('dark');
    } else {
      htmlEl.classList.remove('dark');
      htmlEl.classList.add('light');
    }

    // Load User Profile
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<any>(`${this.backendUrl}/api/auth/me`, { headers }).subscribe({
      next: (user) => {
        this.currentUser = user;
      },
      error: () => {
        this.logout();
      }
    });

    // Load Session History
    this.loadHistory(true);
    this.loadAgentConfigs();
  }

  loadAgentConfigs(): void {
    const token = localStorage.getItem('token');
    if (!token) return;
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<any>(`${this.backendUrl}/api/agents/config`, { headers }).subscribe({
      next: (data) => {
        this.agentConfigs = data;
        this.originalAgentConfigs = JSON.parse(JSON.stringify(data));
      },
      error: (err) => {
        console.error('Failed to load agent configs:', err);
      }
    });
  }

  saveAgentConfigs(): void {
    const token = localStorage.getItem('token');
    if (!token) return;
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.put<any>(`${this.backendUrl}/api/agents/config`, this.agentConfigs, { headers }).subscribe({
      next: (data) => {
        this.agentConfigs = data.configs;
        this.originalAgentConfigs = JSON.parse(JSON.stringify(data.configs));
        this.showToast('Agent configuration deployed successfully.');
      },
      error: (err) => {
        console.error('Failed to save agent configs:', err);
        this.showToast('Failed to deploy configuration. Please try again.', 'error');
      }
    });
  }

  resetAgentConfigs(): void {
    if (confirm('Reset to defaults?')) {
      this.agentConfigs = {
        'Account Executive': { slider1: 65, slider2: 40, customDirectives: '' },
        'Legal': { slider1: 15, slider2: 5, customDirectives: '' },
        'Resource': { slider1: 50, slider2: 75, customDirectives: '' },
        'Financial': { slider1: 30, slider2: 60, customDirectives: '' },
        'Board of Directors': { slider1: 85, slider2: 90, customDirectives: '' }
      };
      this.saveAgentConfigs();
    }
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      if (this.chatScrollContainer) {
        this.chatScrollContainer.nativeElement.scrollTop = this.chatScrollContainer.nativeElement.scrollHeight;
      }
    } catch (err) {}
  }

  loadHistory(autoRestore: boolean = false): void {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<EvaluationSession[]>(`${this.backendUrl}/api/evaluation/history`, { headers }).subscribe({
      next: (data) => {
        this.historyList = data;
        if (autoRestore && this.historyList.length > 0) {
          const latest = this.historyList[0];
          if (latest.final_verdict === 'PENDING') {
            this.restorePendingSession(latest);
          }
        }
      },
      error: (err) => {
        console.error('Failed to load history:', err);
      }
    });
  }

  restorePendingSession(session: EvaluationSession): void {
    const token = localStorage.getItem('token');
    if (!token) return;

    this.evaluating = true;
    this.activeSession = { ...session, final_verdict: 'EVALUATING' };
    this.verdictCollapsed = true;

    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<any>(`${this.backendUrl}/api/evaluation/session/${session.id}`, { headers }).subscribe({
      next: (data) => {
        if (this.activeSession && this.activeSession.id === session.id) {
          this.debateMessages = data.messages;
          this.setupSSEStream(session.id);
        }
      },
      error: (err) => {
        this.evaluating = false;
        console.error('Failed to restore pending session:', err);
      }
    });
  }

  initiateEvaluation(): void {
    if (this.evaluating) return;

    if (!this.validateAll()) {
      return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) return;

    // Reset previous session states
    this.evaluating = true;
    this.activeSession = null;
    this.debateMessages = [];
    this.currentTypingAgent = null;
    this.activeTab = 'console';
    this.verdictCollapsed = true;

    // Map roster items
    const roster: string[] = [];
    if (this.agentsRoster.techArchitect) roster.push('Technical Architect');
    if (this.agentsRoster.riskAnalyst) roster.push('Risk Analyst');
    if (this.agentsRoster.opsManager) roster.push('Operations Manager');
    if (this.agentsRoster.legal) roster.push('Legal');
    if (this.agentsRoster.resource) roster.push('Resource');
    if (this.agentsRoster.finance) roster.push('Financial');

    const body = {
      tenderName: this.tenderName,
      clientName: this.clientName,
      budget: this.budget,
      timelineMonths: this.timelineMonths,
      industry: this.industry,
      roster: roster,
      missionBriefing: this.missionBriefing.trim() || null
    };

    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.post<EvaluationSession>(`${this.backendUrl}/api/evaluation/start`, body, { headers }).subscribe({
      next: (session) => {
        this.activeSession = { ...session, final_verdict: 'EVALUATING' };
        this.setupSSEStream(session.id);
      },
      error: (err) => {
        this.evaluating = false;
        console.error('Failed to start evaluation:', err);
        const errMsg = err.error?.error || 'Could not start evaluation. Please verify database connection.';
        alert(errMsg);
      }
    });
  }

  private setupSSEStream(sessionId: number): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(`${this.backendUrl}/api/evaluation/stream?sessionId=${sessionId}`);

    // Listener for agent typing notifications
    this.eventSource.addEventListener('typing', (event: any) => {
      const data = JSON.parse(event.data);
      this.currentTypingAgent = data.sender;
    });

    // Listener for actual debate messages
    this.eventSource.addEventListener('message', (event: any) => {
      const data = JSON.parse(event.data);
      this.currentTypingAgent = null;
      this.debateMessages.push(data);
    });

    // Listener for the board's final evaluation details
    this.eventSource.addEventListener('verdict', (event: any) => {
      const data = JSON.parse(event.data);
      this.agentFlags = data.agentFlags || {};
      this.activeSession = data;
      this.verdictCollapsed = false; // auto-open when verdict arrives
    });

    // Stream finished listener
    this.eventSource.addEventListener('done', () => {
      if (this.eventSource) {
        this.eventSource.close();
      }
      this.evaluating = false;
      this.loadHistory(); // Reload history pane
    });

    this.eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      if (this.eventSource) {
        this.eventSource.close();
      }
      this.evaluating = false;
    };
  }

  selectHistorySession(session: EvaluationSession): void {
    const token = localStorage.getItem('token');
    if (!token) return;

    this.evaluating = false;
    if (this.eventSource) {
      this.eventSource.close();
    }

    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<any>(`${this.backendUrl}/api/evaluation/session/${session.id}`, { headers }).subscribe({
      next: (data) => {
        this.activeSession = data.session;
        this.debateMessages = data.messages;
        this.currentTypingAgent = null;
        this.activeTab = 'console';
        this.verdictCollapsed = false;
      },
      error: (err) => {
        console.error('Failed to load session details:', err);
      }
    });
  }

  getAgentAvatar(sender: string): string {
    switch(sender) {
      case 'User': return 'account_circle';
      case 'Swarm': return 'sensors';
      case 'Account Executive': return 'person';
      case 'Resource': return 'engineering';
      case 'Technical Architect': return 'architecture';
      case 'Risk Analyst': return 'shield';
      case 'Operations Manager': return 'settings_suggest';
      case 'Legal': return 'gavel';
      case 'Financial': return 'payments';
      case 'Board of Directors': return 'corporate_fare';
      default: return 'smart_toy';
    }
  }

  getAgentDotClass(sender: string): string {
    const map: {[k: string]: string} = {
      'Account Executive': 'bg-indigo-500',
      'Resource': 'bg-blue-500',
      'Technical Architect': 'bg-violet-500',
      'Risk Analyst': 'bg-orange-500',
      'Operations Manager': 'bg-teal-500',
      'Legal': 'bg-rose-500',
      'Financial': 'bg-amber-500',
    };
    return map[sender] || 'bg-primary';
  }

  getAgentStances(): Array<{agent: string, status: 'approved' | 'flagged' | 'conditional'}> {
    // Build list from messages (one entry per agent, Board and User excluded)
    const agentLatest = new Map<string, {text: string, round: number}>();
    for (const msg of this.debateMessages) {
      if (msg.sender !== 'Board of Directors' && msg.sender !== 'User') {
        agentLatest.set(msg.sender, { text: msg.message_text, round: msg.negotiation_round });
      }
    }

    return Array.from(agentLatest.keys()).map(agent => {
      // Server-side flags are authoritative (live session)
      if (this.agentFlags[agent]) {
        return { agent, status: this.agentFlags[agent] as 'approved' | 'flagged' | 'conditional' };
      }

      // Fallback: text-based detection for historical sessions loaded from DB
      const { text, round } = agentLatest.get(agent)!;
      const t = text.toLowerCase();
      let status: 'approved' | 'flagged' | 'conditional';

      const hardBlock = t.includes('no-go') || t.includes('cannot proceed') ||
                        t.includes('staffing gap') || t.includes('none available') ||
                        t.includes('no available') || t.includes('untenable') ||
                        t.includes('financially unviable') || t.includes('shortfall') ||
                        t.includes('must be rejected') || t.includes('no developers');

      const softConcern = t.includes('subject to') || t.includes('condition') ||
                          t.includes('provided that') || t.includes('objection') ||
                          t.includes('flagging') || t.includes('concerns') ||
                          t.includes('cannot approve') || t.includes('will not approve') ||
                          t.includes('resolve before') || t.includes('renegotiat') ||
                          t.includes('high') || t.includes('blocker') || t.includes('insufficient') ||
                          t.includes('must') || t.includes('aggressive');

      const cleared = round >= 2 && (t.includes('withdraw') || t.includes('rescind') ||
                                     t.includes('approve') || t.includes('cleared'));

      if (cleared) status = 'conditional';
      else if (hardBlock) status = 'flagged';
      else if (softConcern) status = 'conditional';
      else status = 'approved';

      return { agent, status };
    });
  }

  toggleAgentDropdown(agent: string, status: string): void {
    if (this.selectedStanceAgent === agent) {
      this.selectedStanceAgent = null;
      this.selectedStanceStatus = null;
      this.selectedStanceReasons = [];
    } else {
      this.selectedStanceAgent = agent;
      this.selectedStanceStatus = status;
      this.selectedStanceReasons = this.extractStanceReasons(agent, status);
    }
  }

  extractStanceReasons(agent: string, status: string): string[] {
    const agentMsgs = this.debateMessages.filter(m => m.sender === agent);
    if (agentMsgs.length === 0) {
      return [`No message received yet from ${agent}.`];
    }
    
    const latestMsg = agentMsgs[agentMsgs.length - 1].message_text;
    const points: string[] = [];
    
    // Split by newlines, bullet point markers (*, -, •), or sentence boundaries
    const lines = latestMsg.split(/\n+/);
    for (let line of lines) {
      line = line.trim();
      line = line.replace(/^[-*•\d\.\s]+/g, '').trim();
      if (!line) continue;
      
      const lower = line.toLowerCase();
      if (lower.startsWith('hello') || 
          lower.startsWith('dear') || 
          lower.includes('deliberation is complete') ||
          lower.includes('review is complete') ||
          lower.includes('assessment is complete') ||
          lower.includes('here is my') ||
          lower.includes('i recommend a go') ||
          lower.includes('strongly advocate for') ||
          lower.includes('boardroom debate') ||
          lower.includes('round ') ||
          lower.includes('deliberating...')) {
        continue;
      }
      
      if (line.includes('. ') && line.length > 120) {
        const sentences = line.split(/(?<=[.!?])\s+/);
        for (let s of sentences) {
          s = s.trim();
          if (s.length > 10) {
            points.push(s);
          }
        }
      } else {
        if (line.length > 10) {
          points.push(line);
        }
      }
    }
    
    if (points.length === 0) {
      const sentences = latestMsg.split(/(?<=[.!?])\s+/);
      for (let s of sentences) {
        s = s.trim();
        const lower = s.toLowerCase();
        if (s.length > 15 && 
            !lower.includes('complete') && 
            !lower.includes('advocate') && 
            !lower.includes('hello')) {
          points.push(s);
        }
      }
    }
    
    if (points.length === 0) {
      return [latestMsg];
    }
    
    return points.slice(0, 6);
  }

  getAgentColorClass(sender: string): string {
    switch(sender) {
      case 'User': return 'border-primary text-primary bg-primary/10';
      case 'Swarm': return 'border-tertiary text-tertiary bg-tertiary/10';
      case 'Account Executive': return 'border-indigo-500 text-indigo-400 bg-indigo-500/10';
      case 'Resource': return 'border-blue-500 text-blue-400 bg-blue-500/10';
      case 'Technical Architect': return 'border-violet-500 text-violet-400 bg-violet-500/10';
      case 'Risk Analyst': return 'border-orange-500 text-orange-400 bg-orange-500/10';
      case 'Operations Manager': return 'border-teal-500 text-teal-400 bg-teal-500/10';
      case 'Legal': return 'border-rose-500 text-rose-400 bg-rose-500/10';
      case 'Financial': return 'border-amber-500 text-amber-400 bg-amber-500/10';
      case 'Board of Directors': return 'border-emerald-500 text-emerald-400 bg-emerald-500/10';
      default: return 'border-primary text-primary bg-primary/10';
    }
  }

  guessCurrentTypingAgent(): string {
    if (this.currentTypingAgent) return this.currentTypingAgent;
    if (!this.activeSession || !this.activeSession.roster) return 'Swarm';

    const roster = this.activeSession.roster;
    const messages = this.debateMessages;

    // Filter out 'User' messages
    const agentMessages = messages.filter(m => m.sender !== 'User');

    // Round 1 order
    const round1Order = [
      'Account Executive',
      'Resource',
      'Technical Architect',
      'Risk Analyst',
      'Operations Manager',
      'Legal',
      'Financial'
    ].filter(a => roster.includes(a));

    // Check which Round 1 agents haven't spoken yet
    for (const agent of round1Order) {
      const hasSpoken = agentMessages.some(m => m.sender === agent && m.negotiation_round === 1);
      if (!hasSpoken) {
        return agent;
      }
    }

    // Round 2 check
    // Check who flagged in Round 1
    const resourceMsg = agentMessages.find(m => m.sender === 'Resource' && m.negotiation_round === 1);
    const resourceFlagged = resourceMsg && (
      resourceMsg.message_text.toLowerCase().includes('staffing gap') ||
      resourceMsg.message_text.toLowerCase().includes('none available') ||
      resourceMsg.message_text.toLowerCase().includes('no available') ||
      resourceMsg.message_text.toLowerCase().includes('shortfall') ||
      resourceMsg.message_text.toLowerCase().includes('cannot staff') ||
      resourceMsg.message_text.toLowerCase().includes('no developers') ||
      resourceMsg.message_text.toLowerCase().includes('0 developers') ||
      resourceMsg.message_text.toLowerCase().includes('not enough') ||
      resourceMsg.message_text.toLowerCase().includes('insufficient') ||
      resourceMsg.message_text.toLowerCase().includes('resolve before')
    );

    const techMsg = agentMessages.find(m => m.sender === 'Technical Architect' && m.negotiation_round === 1);
    const techFlagged = techMsg && (
      techMsg.message_text.toLowerCase().includes('not feasible') ||
      techMsg.message_text.toLowerCase().includes('unrealistic') ||
      techMsg.message_text.toLowerCase().includes('impossible') ||
      techMsg.message_text.toLowerCase().includes('cannot support') ||
      techMsg.message_text.toLowerCase().includes('cannot deliver')
    );

    const riskMsg = agentMessages.find(m => m.sender === 'Risk Analyst' && m.negotiation_round === 1);
    const riskFlagged = riskMsg && (
      riskMsg.message_text.toLowerCase().includes('high') ||
      riskMsg.message_text.toLowerCase().includes('critical') ||
      riskMsg.message_text.toLowerCase().includes('unacceptable')
    );

    const opsMsg = agentMessages.find(m => m.sender === 'Operations Manager' && m.negotiation_round === 1);
    const opsConcern = opsMsg && (
      opsMsg.message_text.toLowerCase().includes('cannot execute') ||
      opsMsg.message_text.toLowerCase().includes('execution gap') ||
      opsMsg.message_text.toLowerCase().includes('not executable') ||
      opsMsg.message_text.toLowerCase().includes('operationally unsound')
    );

    const financeMsg = agentMessages.find(m => m.sender === 'Financial' && m.negotiation_round === 1);
    const financeFlagged = financeMsg && (
      financeMsg.message_text.toLowerCase().includes('negative') ||
      financeMsg.message_text.toLowerCase().includes('deficit') ||
      financeMsg.message_text.toLowerCase().includes('too low') ||
      financeMsg.message_text.toLowerCase().includes('insufficient') ||
      financeMsg.message_text.toLowerCase().includes('unviable') ||
      financeMsg.message_text.toLowerCase().includes('untenable') ||
      financeMsg.message_text.toLowerCase().includes('loss') ||
      financeMsg.message_text.toLowerCase().includes('exceeds') ||
      financeMsg.message_text.toLowerCase().includes('shortfall') ||
      financeMsg.message_text.toLowerCase().includes('blocker') ||
      financeMsg.message_text.toLowerCase().includes('cannot cover') ||
      financeMsg.message_text.toLowerCase().includes('renegotiat')
    );

    const legalMsg = agentMessages.find(m => m.sender === 'Legal' && m.negotiation_round === 1);
    const legalFlagged = legalMsg && (
      legalMsg.message_text.toLowerCase().includes('violation') ||
      legalMsg.message_text.toLowerCase().includes('non-compliant') ||
      legalMsg.message_text.toLowerCase().includes('breach') ||
      legalMsg.message_text.toLowerCase().includes('lawsuit') ||
      legalMsg.message_text.toLowerCase().includes('legal battle') ||
      legalMsg.message_text.toLowerCase().includes('scam') ||
      legalMsg.message_text.toLowerCase().includes('court') ||
      legalMsg.message_text.toLowerCase().includes('litigation') ||
      legalMsg.message_text.toLowerCase().includes('due diligence')
    );

    const anyFlagged = resourceFlagged || techFlagged || riskFlagged || financeFlagged || legalFlagged;

    if (anyFlagged) {
      // 1. Proposer speaks first in round 2
      const proposerName = roster.includes('Account Executive') ? 'Account Executive' : (roster.includes('Financial') ? 'Financial' : null);
      if (proposerName) {
        const proposerRound2 = agentMessages.some(m => m.sender === proposerName && m.negotiation_round === 2);
        if (!proposerRound2) {
          return proposerName;
        }
      }

      // 2. Legal speaks in round 2 if in roster and flagged
      if (legalFlagged && roster.includes('Legal')) {
        const legalRound2 = agentMessages.some(m => m.sender === 'Legal' && m.negotiation_round === 2);
        if (!legalRound2) return 'Legal';
      }

      // 3. Financial reacts as CFO in round 2 if AE was the proposer, Financial is in roster, and finance was flagged
      if (proposerName === 'Account Executive' && roster.includes('Financial') && financeFlagged) {
        const finRound2 = agentMessages.some(m => m.sender === 'Financial' && m.negotiation_round === 2);
        if (!finRound2) return 'Financial';
      }
    }

    // Finally Board of Directors
    const boardSpoken = agentMessages.some(m => m.sender === 'Board of Directors');
    if (!boardSpoken) {
      return 'Board of Directors';
    }

    return 'Swarm';
  }

  formatMoney(val: any): string {
    const num = Number(val);
    return isNaN(num) ? '0' : num.toLocaleString();
  }

  startNewEvaluation(): void {
    if (this.evaluating) return;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    // Reset session state
    this.activeSession = null;
    this.debateMessages = [];
    this.currentTypingAgent = null;
    this.verdictCollapsed = true;
    this.agentFlags = {};
    this.missionBriefing = '';
    this.errors = {};
    this.activeTab = 'console';
    // Clear form
    this.tenderName = '';
    this.clientName = '';
    this.budget = null as any;
    this.timelineMonths = null as any;
    this.industry = 'Healthcare';
  }

  cancelEvaluation(): void {
    // Tell the backend to stop making further Gemini calls for this session
    if (this.activeSession) {
      const token = localStorage.getItem('token');
      const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
      this.http.post(`${this.backendUrl}/api/evaluation/cancel/${this.activeSession.id}`, {}, { headers }).subscribe();
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.evaluating = false;
    this.activeSession = null;
    this.debateMessages = [];
    this.currentTypingAgent = null;
    this.verdictCollapsed = true;
    this.missionBriefing = '';
    this.agentFlags = {};
  }

  onBriefingEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      event.preventDefault();
      this.initiateEvaluation();
    }
  }

  toggleTheme(): void {
    this.isDarkMode = !this.isDarkMode;
    const htmlEl = document.documentElement;
    if (this.isDarkMode) {
      htmlEl.classList.remove('light');
      htmlEl.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      htmlEl.classList.remove('dark');
      htmlEl.classList.add('light');
      localStorage.setItem('theme', 'light');
    }
  }

  logout(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }
    localStorage.removeItem('token');
    this.router.navigate(['/login']);
  }
}
