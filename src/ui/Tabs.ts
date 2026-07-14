/** 상단 탭바를 관리. 모드 등록 시 버튼을 추가하고 활성 표시를 갱신합니다. */
export class Tabs {
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(private readonly root: HTMLElement) {}

  add(id: string, label: string, onSelect: () => void): void {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.mode = id;
    btn.addEventListener('click', onSelect);
    this.root.appendChild(btn);
    this.buttons.set(id, btn);
  }

  setActive(id: string): void {
    for (const [key, btn] of this.buttons) {
      btn.classList.toggle('active', key === id);
    }
  }
}
