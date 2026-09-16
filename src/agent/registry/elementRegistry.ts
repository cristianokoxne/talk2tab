export class ElementRegistry {
  private generation = 0;
  private sequence = 0;
  private readonly elements = new Map<string, HTMLElement>();

  beginGeneration(): number {
    this.generation += 1;
    this.sequence = 0;
    this.elements.clear();
    return this.generation;
  }

  register(element: HTMLElement): string {
    this.sequence += 1;
    const ref = `el_${this.generation}_${this.sequence}`;
    this.elements.set(ref, element);
    return ref;
  }

  get(ref: string): HTMLElement | undefined {
    return this.elements.get(ref);
  }

  has(ref: string): boolean {
    return this.elements.has(ref);
  }

  getGeneration(): number {
    return this.generation;
  }
}
