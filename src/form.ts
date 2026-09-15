import type { ParamField, Params, PointField, Waypoint } from './scenes/types';

export interface FormHooks {
  /** Fired after any edit; `valid` is false when some field is out of range or empty. */
  onChange(valid: boolean): void;
  /** Fired when a point's "Pick in view" button is clicked. */
  onPick(key: string): void;
}

export interface FormHandle {
  /** Writes the current param values into the inputs. */
  refresh(): void;
  /** Highlights the point whose pick button is armed (null for none). */
  setArmed(key: string | null): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/**
 * Renders a segment's parameter form from its field schema and keeps `params`
 * in sync with the inputs. Edits are written straight into `params`.
 */
export function renderForm(root: HTMLElement, fields: ParamField[], params: Params, hooks: FormHooks): FormHandle {
  root.replaceChildren();
  const inputs: { input: HTMLInputElement | HTMLSelectElement; read(): boolean; write(): void }[] = [];
  const pickButtons = new Map<string, HTMLButtonElement>();
  const controls: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];

  const numberInput = (step: number, min?: number, max?: number): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    controls.push(input);
    return input;
  };

  const labelled = (text: string, input: HTMLElement): HTMLLabelElement => {
    const label = document.createElement('label');
    label.append(text, input);
    return label;
  };

  const bindNumber = (
    input: HTMLInputElement,
    min: number,
    max: number,
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string = String,
  ) => {
    inputs.push({
      input,
      read() {
        const v = Number(input.value);
        const ok = input.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max;
        input.classList.toggle('invalid', !ok);
        if (ok) set(v);
        return ok;
      },
      write() {
        input.value = format(get());
        input.classList.remove('invalid');
      },
    });
  };

  const renderPoint = (field: PointField) => {
    const fieldset = document.createElement('fieldset');
    const header = document.createElement('div');
    header.className = 'point-header';
    const title = document.createElement('strong');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = field.color;
    title.append(dot, field.label);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = 'Pick in view';
    pick.addEventListener('click', () => hooks.onPick(field.key));
    pickButtons.set(field.key, pick);
    controls.push(pick);
    header.append(title, pick);

    const grid = document.createElement('div');
    grid.className = 'fields';
    const lat = numberInput(0.0001, -90, 90);
    const lng = numberInput(0.0001, -180, 180);
    const height = numberInput(10);
    grid.append(
      labelled('Latitude', lat),
      labelled('Longitude', lng),
      labelled(`${field.heightLabel ?? 'Height above ground'} (m)`, height),
    );
    fieldset.append(header, grid);

    const point = () => params[field.key] as Waypoint;
    const fixed = (v: number) => v.toFixed(5);
    bindNumber(lat, -90, 90, () => point().lat, (v) => (point().lat = v), fixed);
    bindNumber(lng, -180, 180, () => point().lng, (v) => (point().lng = v), fixed);
    bindNumber(height, -10_000, 100_000, () => point().height, (v) => (point().height = v));
    return fieldset;
  };

  const numberRows = document.createElement('div');
  numberRows.className = 'number-grid';

  for (const field of fields) {
    if (field.kind === 'point') {
      root.append(renderPoint(field));
    } else if (field.kind === 'number') {
      const input = numberInput(field.step, field.min, field.max);
      bindNumber(
        input,
        field.min,
        field.max,
        () => params[field.key] as number,
        (v) => (params[field.key] = v),
      );
      numberRows.append(labelled(field.unit ? `${field.label} (${field.unit})` : field.label, input));
    } else {
      const select = document.createElement('select');
      for (const opt of field.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.append(o);
      }
      controls.push(select);
      inputs.push({
        input: select,
        read() {
          params[field.key] = select.value;
          return true;
        },
        write() {
          select.value = String(params[field.key]);
        },
      });
      numberRows.append(labelled(field.label, select));
    }
  }
  if (numberRows.childElementCount > 0) root.append(numberRows);

  const onInput = () => {
    let valid = true;
    for (const binding of inputs) valid = binding.read() && valid;
    hooks.onChange(valid);
  };
  for (const binding of inputs) binding.input.addEventListener('input', onInput);

  const refresh = () => {
    for (const binding of inputs) binding.write();
  };
  refresh();

  return {
    refresh,
    setArmed(key) {
      for (const [k, btn] of pickButtons) btn.classList.toggle('armed', k === key);
    },
    setEnabled(enabled) {
      for (const el of controls) el.disabled = !enabled;
    },
    destroy() {
      for (const binding of inputs) binding.input.removeEventListener('input', onInput);
      root.replaceChildren();
    },
  };
}
