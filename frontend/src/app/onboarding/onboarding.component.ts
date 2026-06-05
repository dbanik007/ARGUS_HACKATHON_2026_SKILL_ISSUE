import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { EmployeeService, ImportValidationError } from '../services/employee.service';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './onboarding.component.html',
})
export class OnboardingComponent implements OnInit {
  readonly backendUrl = 'http://localhost:3000';
  currentStep = 1;
  readonly totalSteps = 3;

  // Company is persisted to the DB when the user advances from step 2 → 3.
  // We track this so hitting "Back" and "Next" again doesn't re-create it.
  companyCreated = false;
  savingCompany = false;
  submitError = '';

  // Step 1 — Company profile
  company = {
    name: '',
    industry: '',
    address: '',
    website: '',
    registration_number: '',
    size_category: 'medium'
  };

  // Step 2 — Financial snapshot
  financials = {
    fiscal_year: new Date().getFullYear(),
    annual_revenue:               null as number | null,
    working_capital:              null as number | null,
    total_debt:                   null as number | null,
    active_project_value:         null as number | null,
    annual_payroll:               null as number | null,
    overhead_rate_percent:        20   as number,
    target_profit_margin_percent: 15   as number,
    max_bid_capacity_override:    null as number | null
  };

  // Step 3 — Employee import
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  selectedFile: File | null = null;
  isDragOver = false;
  uploadState: UploadState = 'idle';
  importedCount = 0;
  importErrors: ImportValidationError[] = [];
  importGlobalError = '';

  readonly industryOptions = [
    'Information Technology',
    'Healthcare',
    'Finance & Banking',
    'Manufacturing',
    'Retail & E-Commerce',
    'Education',
    'Construction & Infrastructure',
    'Energy & Utilities',
    'Telecommunications',
    'Government & Public Sector',
    'Consulting',
    'Other'
  ];

  readonly sizeOptions = [
    { value: 'startup',    label: 'Startup (1–10 employees)' },
    { value: 'small',      label: 'Small (11–50 employees)' },
    { value: 'medium',     label: 'Medium (51–250 employees)' },
    { value: 'large',      label: 'Large (251–1000 employees)' },
    { value: 'enterprise', label: 'Enterprise (1000+ employees)' }
  ];

  constructor(
    private http: HttpClient,
    private router: Router,
    private employeeService: EmployeeService
  ) {}

  ngOnInit(): void {
    if (!localStorage.getItem('token')) {
      this.router.navigate(['/login']);
      return;
    }
    const token = localStorage.getItem('token') ?? '';
    this.http.get<{ onboarded: boolean }>(
      `${this.backendUrl}/api/onboarding/status`,
      { headers: new HttpHeaders().set('Authorization', `Bearer ${token}`) }
    ).subscribe({
      next: (res) => { if (res.onboarded) this.router.navigate(['/dashboard']); },
      error: () => {}
    });
  }

  get stepValid(): boolean {
    if (this.currentStep === 1) return this.company.name.trim().length > 0;
    if (this.currentStep === 2) {
      return !!(
        this.financials.annual_revenue  && this.financials.annual_revenue  > 0 &&
        this.financials.working_capital !== null && this.financials.working_capital >= 0 &&
        this.financials.annual_payroll  && this.financials.annual_payroll  > 0
      );
    }
    return true;
  }

  nextStep(): void {
    if (!this.stepValid) return;
    if (this.currentStep === 2 && !this.companyCreated) {
      // Persist company + financials before showing the import step so that
      // any subsequent employee upload is correctly scoped to this company.
      this.persistCompany(() => { this.currentStep = 3; });
    } else if (this.currentStep < this.totalSteps) {
      this.currentStep++;
    }
  }

  prevStep(): void {
    if (this.currentStep > 1) this.currentStep--;
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${localStorage.getItem('token') ?? ''}`);
  }

  private persistCompany(onSuccess: () => void): void {
    this.savingCompany = true;
    this.submitError = '';

    const payload = {
      ...this.company,
      ...this.financials,
      total_debt:           this.financials.total_debt           ?? 0,
      active_project_value: this.financials.active_project_value ?? 0
    };

    this.http.post(`${this.backendUrl}/api/onboarding/company`, payload, {
      headers: this.authHeaders()
    }).subscribe({
      next: () => {
        this.companyCreated = true;
        this.savingCompany = false;
        onSuccess();
      },
      error: (err) => {
        this.savingCompany = false;
        this.submitError = err.error?.error ?? 'Failed to save organisation details. Please try again.';
      }
    });
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  // ── Employee import (Step 3) ──────────────────────────────────────────────

  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragOver = true; }
  onDragLeave(e: DragEvent): void { e.preventDefault(); this.isDragOver = false; }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) this.setFile(file);
  }

  onFileInput(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.setFile(file);
  }

  triggerFilePicker(): void { this.fileInputRef.nativeElement.click(); }

  private setFile(file: File): void {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'csv' && ext !== 'xlsx') {
      this.importGlobalError = 'Only .csv and .xlsx files are supported.';
      return;
    }
    this.selectedFile = file;
    this.uploadState = 'idle';
    this.importErrors = [];
    this.importGlobalError = '';
  }

  fileSizeLabel(): string {
    if (!this.selectedFile) return '';
    const kb = this.selectedFile.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
  }

  downloadTemplate(): void { this.employeeService.downloadTemplate(); }

  uploadEmployees(): void {
    if (!this.selectedFile || this.uploadState === 'uploading') return;
    this.uploadState = 'uploading';
    this.importErrors = [];
    this.importGlobalError = '';

    this.employeeService.importFile(this.selectedFile).subscribe({
      next: (result) => {
        this.uploadState = 'success';
        this.importedCount = result.imported;
      },
      error: (err) => {
        this.uploadState = 'error';
        const body = err.error;
        if (body?.errors?.length) {
          this.importErrors = body.errors;
        } else {
          this.importGlobalError = body?.message ?? 'Upload failed. Please try again.';
        }
      }
    });
  }
}
