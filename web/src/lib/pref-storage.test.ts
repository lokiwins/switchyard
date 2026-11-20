import { beforeEach, describe, expect, it } from 'vitest';
import { bareField, prefFieldsStorage, stringListField } from './pref-storage';

const isColor = (value: string): value is 'red' | 'blue' => value === 'red' || value === 'blue';
const storage = () => prefFieldsStorage({ color: bareField('test.color', isColor), open: stringListField('test.open') });

describe('prefFieldsStorage', () => {
  beforeEach(() => localStorage.clear());

  it('reads each field from its own key, as the old pages saved it', () => {
    localStorage.setItem('test.color', 'blue');
    localStorage.setItem('test.open', '["/a","/b"]');
    expect(JSON.parse(storage().getItem('x') as string)).toEqual({ state: { color: 'blue', open: ['/a', '/b'] }, version: 0 });
  });

  it('leaves out a saved value that is no longer one of the choices, or not a list', () => {
    localStorage.setItem('test.color', 'green');
    localStorage.setItem('test.open', '{"not":"a list"}');
    expect(JSON.parse(storage().getItem('x') as string).state).toEqual({});
  });

  it('writes each field back to its own key', () => {
    storage().setItem('x', JSON.stringify({ state: { color: 'red', open: ['/c'] }, version: 0 }));
    expect(localStorage.getItem('test.color')).toBe('red');
    expect(localStorage.getItem('test.open')).toBe('["/c"]');
  });
});
