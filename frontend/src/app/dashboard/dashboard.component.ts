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
  
  // Agent Roster Options
  agentsRoster = {
    sales: true, // Account Executive: Required
    resource: true,
    legal: true,
    finance: true
  };

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
    this.http.post<EvaluationSession>(`${`${this.backendUrl}/api/evaluation/start`}`, body, { headers }).subscribe({
      next: (session) => {
        this.activeSession = { ...session, final_verdict: 'EVALUATING' };
        this.setupSSEStream(session.id);
      },
      error: (err) => {
        this.evaluating = false;
        console.error('Failed to start evaluation:', err);
        alert('Could not start evaluation. Please verify database connection.');
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
