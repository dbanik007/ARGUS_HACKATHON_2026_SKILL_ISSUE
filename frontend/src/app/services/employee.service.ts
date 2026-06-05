import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ImportSuccess {
  imported: number;
  message: string;
}

export interface ImportValidationError {
  row: number;
  field: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private readonly backendUrl = 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token') ?? '';
    return new HttpHeaders().set('Authorization', `Bearer ${token}`);
  }

  downloadTemplate(): void {
    this.http
      .get(`${this.backendUrl}/api/employees/template`, {
        headers: this.authHeaders(),
        responseType: 'blob',
      })
      .subscribe(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'employee_import_template.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  importFile(file: File): Observable<ImportSuccess> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ImportSuccess>(
      `${this.backendUrl}/api/employees/import`,
      formData,
      { headers: this.authHeaders() }
    );
  }
}
