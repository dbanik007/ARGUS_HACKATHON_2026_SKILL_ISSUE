import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map, catchError, of } from 'rxjs';

const BACKEND_URL = 'http://localhost:3000';

export const companyGuard = () => {
  const router = inject(Router);
  const http = inject(HttpClient);
  const token = localStorage.getItem('token');

  if (!token) {
    router.navigate(['/login']);
    return of(false);
  }

  return http.get<{ onboarded: boolean }>(
    `${BACKEND_URL}/api/onboarding/status`,
    { headers: new HttpHeaders().set('Authorization', `Bearer ${token}`) }
  ).pipe(
    map(res => {
      if (res.onboarded) return true;
      router.navigate(['/onboarding']);
      return false;
    }),
    catchError(() => of(true)) // allow through on network error; backend will 401 if needed
  );
};
