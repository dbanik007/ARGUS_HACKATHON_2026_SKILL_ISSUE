import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';

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
  mockLoading: boolean = false;
  backendUrl = 'http://localhost:3000';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    // Intercept Google OAuth token from URL query params
    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      if (token) {
        localStorage.setItem('token', token);
        this.router.navigate(['/dashboard']);
      }
    });

    // If already logged in, redirect
    if (localStorage.getItem('token')) {
      this.router.navigate(['/dashboard']);
    }
  }

  loginWithGoogle(): void {
    this.googleLoading = true;
    window.location.href = `${this.backendUrl}/api/auth/google`;
  }

  loginWithMock(): void {
    this.mockLoading = true;
    this.errorMessage = '';
    this.http.get<{ token: string, user: any }>(`${this.backendUrl}/api/auth/mock-login`).subscribe({
      next: (res) => {
        localStorage.setItem('token', res.token);
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.mockLoading = false;
        console.error('Mock login failed:', err);
        this.errorMessage = 'Mock authentication failed. Ensure backend service is active.';
      }
    });
  }
}
