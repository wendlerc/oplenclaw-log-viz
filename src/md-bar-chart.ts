const MAX_BAR = 20;

export function renderMdBarChart(
  container: HTMLElement,
  items: { file: string; count: number; bytes: number }[]
) {
  const total = items.reduce((s, i) => s + i.count, 0);

  if (total === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <p>No MD file writes detected in logs.</p>
        <p>Place logs in <code>./logs/</code> and run <code>npm run parse</code></p>
        <p>Or run <code>npm run sample</code> for demo data.</p>
      </div>
    `;
    return;
  }

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  container.innerHTML = items
    .map((item) => {
      const pct = (item.count / maxCount) * 100;
      const barWidth = Math.max(4, (item.count / maxCount) * 100);
      return `
        <div class="bar-item">
          <div class="label">${item.file}</div>
          <div class="value">${item.count}</div>
          ${item.bytes > 0 ? `<div class="bytes">${formatBytes(item.bytes)}</div>` : ""}
          <div style="margin-top:0.5rem;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:var(--accent);border-radius:3px;transition:width .3s"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}
