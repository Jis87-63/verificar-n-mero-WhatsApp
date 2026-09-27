const status = document.querySelector('#service-status');
const detail = document.querySelector('#status-detail');
const indicator = document.querySelector('#indicator');
async function checkHealth() {
  status.textContent = 'A verificar…'; indicator.className = 'indicator pending';
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    status.textContent = 'Servidor a funcionar'; detail.textContent = `Resposta: ${health.status} · atualizado agora`; indicator.className = 'indicator online';
  } catch (error) { status.textContent = 'Servidor indisponível'; detail.textContent = 'Não foi possível obter /health. Tente novamente.'; indicator.className = 'indicator offline'; }
}
document.querySelector('#refresh').addEventListener('click', checkHealth); checkHealth();
