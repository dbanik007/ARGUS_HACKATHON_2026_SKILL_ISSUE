import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';

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
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './dashboard.component.html',
  styleUrls: []
})
export class DashboardComponent implements OnInit, AfterViewChecked {
  @ViewChild('chatScrollContainer') private chatScrollContainer!: ElementRef;

  // Session user details
  currentUser: any = null;

  // Form Inputs
  tenderName: string = 'Next-Gen Medical Telemetry Suite';
  clientName: string = 'St. Jude Clinical';
  budget: number = 85000;
  timelineMonths: number = 6;
  industry: string = 'Healthcare';
  
  // Validation errors
  errors: { [key: string]: string } = {};

  // Agent Roster Options
  agentsRoster = {
    sales: true, // Account Executive: Required
    resource: true,
    legal: true,
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
  }

  validateAll(): boolean {
    this.validateField('tenderName');
    this.validateField('clientName');
    this.validateField('budget');
    this.validateField('timelineMonths');
    return Object.keys(this.errors).length === 0;
  }

  // Evaluation States
  activeSession: EvaluationSession | null = null;
  debateMessages: DebateMessage[] = [];
  currentTypingAgent: string | null = null;
  evaluating: boolean = false;
  activeTab: 'console' | 'history' = 'console';
  
  // Historical sessions
  historyList: EvaluationSession[] = [];
  
  backendUrl = 'http://localhost:3000';
  private eventSource: EventSource | null = null;

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    const token = localStorage.getItem('token');
    if (!token) {
      this.router.navigate(['/login']);
      return;
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
    this.loadHistory();
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

  loadHistory(): void {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    this.http.get<EvaluationSession[]>(`${this.backendUrl}/api/evaluation/history`, { headers }).subscribe({
      next: (data) => {
        this.historyList = data;
      },
      error: (err) => {
        console.error('Failed to load history:', err);
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

    // Map roster items
    const roster: string[] = ['Account Executive'];
    if (this.agentsRoster.resource) roster.push('Resource');
    if (this.agentsRoster.legal) roster.push('Legal');
    if (this.agentsRoster.finance) roster.push('Financial');

    const body = {
      tenderName: this.tenderName,
      clientName: this.clientName,
      budget: this.budget,
      timelineMonths: this.timelineMonths,
      industry: this.industry,
      roster: roster
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
      this.activeSession = data;
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
      },
      error: (err) => {
        console.error('Failed to load session details:', err);
      }
    });
  }

  getAgentAvatar(sender: string): string {
    switch(sender) {
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

  getAgentColorClass(sender: string): string {
    switch(sender) {
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

  formatMoney(val: any): string {
    const num = Number(val);
    return isNaN(num) ? '0' : num.toLocaleString();
  }

  logout(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }
    localStorage.removeItem('token');
    this.router.navigate(['/login']);
  }
}
