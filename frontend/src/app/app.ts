import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('boardroom-frontend');

  ngOnInit(): void {
    const savedTheme = localStorage.getItem('theme');
    const isDark = savedTheme ? savedTheme === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
    const htmlEl = document.documentElement;
    if (isDark) {
      htmlEl.classList.remove('light');
      htmlEl.classList.add('dark');
    } else {
      htmlEl.classList.remove('dark');
      htmlEl.classList.add('light');
    }
  }
}

