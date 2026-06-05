import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './login.component.html',
  styleUrls: []
})
export class LoginComponent implements OnInit {
  errorMessage: string = '';
  googleLoading: boolean = false;
  readonly backendUrl = 'http://localhost:3000';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      if (token) {
        localStorage.setItem('token', token);
        this.redirectAfterLogin();
      }
    });

    if (localStorage.getItem('token')) {
      this.redirectAfterLogin();
    }
  }

  loginWithGoogle(): void {
    this.googleLoading = true;
    window.location.href = `${this.backendUrl}/api/auth/google`;
  }

  private redirectAfterLogin(): void {
    const token = localStorage.getItem('token') ?? '';
    this.http.get<{ onboarded: boolean }>(
      `${this.backendUrl}/api/onboarding/status`,
      { headers: new HttpHeaders().set('Authorization', `Bearer ${token}`) }
    ).subscribe({
      next: (res) => {
        this.router.navigate([res.onboarded ? '/dashboard' : '/onboarding']);
      },
      error: () => {
        // If status check fails, fall back to dashboard (guard will redirect if needed)
        this.router.navigate(['/dashboard']);
      }
    });
  }
}
