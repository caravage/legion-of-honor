/**
 * Accès au stockage du navigateur.
 *
 * Isolé ici pour deux raisons : le moteur tourne aussi sous Node, où
 * `localStorage` n'existe pas, et un navigateur peut refuser l'écriture
 * (navigation privée, quota atteint). Tout échec est silencieux : une partie
 * qui ne peut pas être sauvegardée continue de se jouer.
 */

const SAVE_KEY = 'loh-save-v1';
const HALL_KEY = 'loh-hall';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSave<T>(): T | null {
  try {
    const raw = store()?.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSave(data: unknown): void {
  try {
    store()?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* stockage indisponible : la partie continue sans filet */
  }
}

export function hasSave(): boolean {
  try {
    return store()?.getItem(SAVE_KEY) != null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    store()?.removeItem(SAVE_KEY);
  } catch {
    /* rien à faire */
  }
}

export interface HallEntry {
  name: string;
  rank: string;
  title: string | null;
  G: number;
  loh: number;
  money: number;
  victory: boolean;
  total: number;
  date: string;
}

export function readHall(): HallEntry[] {
  try {
    return JSON.parse(store()?.getItem(HALL_KEY) ?? '[]') as HallEntry[];
  } catch {
    return [];
  }
}

/** Range une carrière au panthéon et n'en garde que les vingt meilleures. */
export function pushHall(entry: HallEntry): void {
  try {
    const list = readHall();
    list.push(entry);
    list.sort((a, b) => b.total - a.total);
    store()?.setItem(HALL_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* stockage indisponible */
  }
}
