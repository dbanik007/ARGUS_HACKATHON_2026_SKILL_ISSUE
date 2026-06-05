import { Component, EventEmitter, Input, Output, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { EmployeeService, ImportValidationError } from '../services/employee.service';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

@Component({
  selector: 'app-import-modal',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './import-modal.component.html',
})
export class ImportModalComponent {
  @Input() isOpen = false;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  selectedFile: File | null = null;
  isDragOver = false;
  state: UploadState = 'idle';
  importedCount = 0;
  errors: ImportValidationError[] = [];
  globalError = '';

  constructor(private employeeService: EmployeeService) {}

  close(): void {
    this.reset();
    this.closed.emit();
  }

  reset(): void {
    this.selectedFile = null;
    this.isDragOver = false;
    this.state = 'idle';
    this.importedCount = 0;
    this.errors = [];
    this.globalError = '';
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver = false;
  }

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

  triggerFilePicker(): void {
    this.fileInputRef.nativeElement.click();
  }

  private setFile(file: File): void {
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'csv' && ext !== 'xlsx') {
      this.globalError = 'Only .csv and .xlsx files are supported.';
      return;
    }
    this.selectedFile = file;
    this.state = 'idle';
    this.errors = [];
    this.globalError = '';
  }

  fileSizeLabel(): string {
    if (!this.selectedFile) return '';
    const kb = this.selectedFile.size / 1024;
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
  }

  downloadTemplate(): void {
    this.employeeService.downloadTemplate();
  }

  upload(): void {
    if (!this.selectedFile || this.state === 'uploading') return;
    this.state = 'uploading';
    this.errors = [];
    this.globalError = '';

    this.employeeService.importFile(this.selectedFile).subscribe({
      next: result => {
        this.state = 'success';
        this.importedCount = result.imported;
      },
      error: err => {
        this.state = 'error';
        const body = err.error;
        if (body?.errors?.length) {
          this.errors = body.errors;
        } else {
          this.globalError = body?.message ?? 'Upload failed. Please try again.';
        }
      },
    });
  }
}
