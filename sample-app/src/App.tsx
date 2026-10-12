import React from 'react'

function App() {
  return (
    <div>
      {/* Navigation */}
      <nav className="nav">
        <span className="nav-brand">PixelPerfect</span>
        <ul className="nav-links">
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#docs">Docs</a></li>
          <li><a href="#blog">Blog</a></li>
        </ul>
      </nav>

      {/* Hero */}
      <section className="hero">
        <span className="badge">NEW — Gemma 4 Powered</span>
        <h1>Catch UI regressions before your users do</h1>
        <p>
          LintCanvas automatically compares your reference design against the
          live rendered page, finds discrepancies, and proposes targeted CSS fixes.
        </p>
        {/* This button is intentionally hidden via display:none bug */}
        <button className="cta-button" id="get-started-btn">
          <span>Get Started</span>
          <span>→</span>
        </button>
      </section>

      {/* Feature Cards */}
      <section id="features">
        <div className="cards-grid">
          <div className="card">
            <div className="card-icon">🔍</div>
            <h3>Visual Diff</h3>
            <p>Pixel-level comparison between your Figma reference and the live page, with highlighted mismatch regions.</p>
          </div>
          <div className="card">
            <div className="card-icon">🤖</div>
            <h3>AI Diagnosis</h3>
            <p>Gemma 4 interprets visual discrepancies and maps them to likely CSS root causes in your source files.</p>
          </div>
          <div className="card">
            <div className="card-icon">🔧</div>
            <h3>Verified Repairs</h3>
            <p>Minimal CSS patches with before/after verification and automatic rollback if a fix causes regressions.</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="stats-section">
        <div className="stats-grid">
          <div>
            <div className="stat-value">94%</div>
            <div className="stat-label">Detection Recall</div>
          </div>
          <div>
            <div className="stat-value">87%</div>
            <div className="stat-label">Repair Success</div>
          </div>
          <div>
            <div className="stat-value">&lt;3s</div>
            <div className="stat-label">Analysis Time</div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 LintCanvas Contributors — Apache 2.0 License</p>
      </footer>
    </div>
  )
}

export default App
