import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let now = 0;
  const breaker = () => new CircuitBreaker(3, 1000, () => now);

  beforeEach(() => {
    now = 0;
  });

  it('stays closed below the failure threshold', () => {
    const b = breaker();
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen()).toBe(false);
  });

  it('opens at the threshold and stays open for the cooldown', () => {
    const b = breaker();
    for (let i = 0; i < 3; i++) b.recordFailure();
    expect(b.isOpen()).toBe(true);
    now = 999;
    expect(b.isOpen()).toBe(true);
  });

  it('half-opens after the cooldown; one more failure re-opens it', () => {
    const b = breaker();
    for (let i = 0; i < 3; i++) b.recordFailure();
    now = 1000;
    expect(b.isOpen()).toBe(false);
    b.recordFailure();
    expect(b.isOpen()).toBe(true);
  });

  it('closes fully after a success', () => {
    const b = breaker();
    for (let i = 0; i < 3; i++) b.recordFailure();
    now = 1000;
    b.isOpen();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen()).toBe(false);
  });

  it('resets the consecutive count on success', () => {
    const b = breaker();
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.isOpen()).toBe(false);
  });
});
