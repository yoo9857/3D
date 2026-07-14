/**
 * 컨트롤 패널 빌더.
 * 모드는 이 API 로만 UI 를 구성하므로, DOM 조작이 한 곳에 모여
 * 유지보수와 스타일 일관성이 유지됩니다.
 *
 * 모든 add* 메서드는 값을 갱신할 수 있는 "핸들" 객체를 반환합니다.
 */

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  /** 표시용 포매터. 미지정 시 숫자 그대로 표시 */
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export interface ToggleOptions {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export interface ButtonGroupOptions {
  buttons: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
}

export interface UploadOptions {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}

let uid = 0;
const nextId = (): string => `p${uid++}`;

export class Panel {
  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.root.innerHTML = '';
    this.root.scrollTop = 0;
  }

  /** 제목·설명·(선택)수식 블록 */
  section(title: string, description: string, formulaHtml?: string): void {
    const t = document.createElement('div');
    t.className = 'p-title';
    t.textContent = title;

    const d = document.createElement('div');
    d.className = 'p-desc';
    d.innerHTML = description; // 설명 문자열은 코드 내 상수(신뢰 가능)

    this.root.append(t, d);

    if (formulaHtml) {
      const f = document.createElement('div');
      f.className = 'formula';
      f.innerHTML = formulaHtml;
      this.root.appendChild(f);
    }
  }

  slider(opts: SliderOptions): { set: (v: number) => void } {
    const id = nextId();
    const step = opts.step ?? 0.01;
    const fmt = opts.format ?? ((v: number) => String(v));

    const wrap = document.createElement('div');
    wrap.className = 'ctrl';

    const label = document.createElement('label');
    const valSpan = document.createElement('b');
    valSpan.textContent = fmt(opts.value);
    label.append(document.createTextNode(opts.label + ' '), valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.step = String(step);
    input.value = String(opts.value);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = fmt(v);
      opts.onInput(v);
    });

    wrap.append(label, input);
    this.root.appendChild(wrap);

    // 초기값 반영
    opts.onInput(opts.value);

    return {
      set: (v: number) => {
        input.value = String(v);
        valSpan.textContent = fmt(v);
      },
    };
  }

  toggle(opts: ToggleOptions): { set: (v: boolean) => void } {
    const row = document.createElement('div');
    row.className = 'toggle-row';

    const span = document.createElement('span');
    span.textContent = opts.label;

    const sw = document.createElement('label');
    sw.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = opts.value;
    const knob = document.createElement('span');
    knob.className = 'slider-sw';
    sw.append(input, knob);

    input.addEventListener('change', () => opts.onChange(input.checked));

    row.append(span, sw);
    this.root.appendChild(row);

    return { set: (v: boolean) => (input.checked = v) };
  }

  buttonGroup(opts: ButtonGroupOptions): { setActive: (id: string) => void } {
    const row = document.createElement('div');
    row.className = 'btn-row';

    const map = new Map<string, HTMLButtonElement>();
    const setActive = (id: string): void => {
      for (const [key, btn] of map) btn.classList.toggle('on', key === id);
    };

    for (const b of opts.buttons) {
      const btn = document.createElement('button');
      btn.className = 'mini-btn';
      btn.type = 'button';
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        setActive(b.id);
        opts.onSelect(b.id);
      });
      map.set(b.id, btn);
      row.appendChild(btn);
    }

    this.root.appendChild(row);
    setActive(opts.active);

    return { setActive };
  }

  uploadButton(opts: UploadOptions): void {
    const id = nextId();
    const label = document.createElement('label');
    label.className = 'upload-btn';
    label.htmlFor = id;
    label.textContent = opts.label;

    const input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    input.accept = opts.accept;
    input.hidden = true;

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) opts.onFile(file);
      input.value = ''; // 같은 파일 재선택 허용
    });

    this.root.append(label, input);
  }


  /** 라벨 + 값 표시 줄. set() 으로 값 갱신 */
  readout(label: string, initial = ''): { set: (text: string) => void } {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const l = document.createElement('label');
    const val = document.createElement('b');
    val.textContent = initial;
    l.append(document.createTextNode(label + ' '), val);
    wrap.appendChild(l);
    this.root.appendChild(wrap);
    return { set: (text: string) => (val.textContent = text) };
  }

  /** 4×4 행렬 등 모노스페이스 텍스트 표시 */
  matrix(label: string): { set: (text: string) => void } {
    const l = document.createElement('label');
    l.className = 'readout-label';
    l.textContent = label;
    const box = document.createElement('div');
    box.className = 'matrix';
    this.root.append(l, box);
    return { set: (text: string) => (box.textContent = text) };
  }

  /** 임의의 DOM 노드를 패널에 추가 */
  element(node: HTMLElement): void {
    this.root.appendChild(node);
  }

  /** 텍스트 입력창(엔드포인트 URL, API 키 등) */
  textInput(opts: {
    label: string;
    placeholder?: string;
    value?: string;
    password?: boolean;
    onChange: (v: string) => void;
  }): { get: () => string; set: (v: string) => void } {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const label = document.createElement('label');
    label.textContent = opts.label;
    const input = document.createElement('input');
    input.type = opts.password ? 'password' : 'text';
    input.className = 'text-input';
    input.placeholder = opts.placeholder ?? '';
    input.value = opts.value ?? '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('change', () => opts.onChange(input.value.trim()));
    wrap.append(label, input);
    this.root.appendChild(wrap);
    return { get: () => input.value.trim(), set: (v: string) => (input.value = v) };
  }

  /** 회색 도움말 문구 */
  hint(text: string): void {
    const el = document.createElement('div');
    el.className = 'hint';
    el.textContent = text;
    this.root.appendChild(el);
  }

  /** 전체 폭 상태 표시줄(진행 상황 등). set() 으로 갱신 */
  status(initial = ''): { set: (text: string) => void } {
    const el = document.createElement('div');
    el.className = 'status-line';
    el.textContent = initial;
    this.root.appendChild(el);
    return { set: (text: string) => (el.textContent = text) };
  }

  /** 동작 버튼 묶음(토글 아님). 활성/비활성 제어 가능 */
  actions(buttons: Array<{ id: string; label: string; onClick: () => void }>): {
    setEnabled: (id: string, enabled: boolean) => void;
    setEnabledAll: (enabled: boolean) => void;
  } {
    const row = document.createElement('div');
    row.className = 'btn-row';
    const map = new Map<string, HTMLButtonElement>();

    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'mini-btn';
      btn.type = 'button';
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        if (!btn.disabled) b.onClick();
      });
      map.set(b.id, btn);
      row.appendChild(btn);
    }
    this.root.appendChild(row);

    return {
      setEnabled: (id, enabled) => {
        const btn = map.get(id);
        if (btn) btn.disabled = !enabled;
      },
      setEnabledAll: (enabled) => {
        for (const btn of map.values()) btn.disabled = !enabled;
      },
    };
  }
}
