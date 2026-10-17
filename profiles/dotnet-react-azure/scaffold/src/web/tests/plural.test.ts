// The web side of counted strings (src/plural.ts). Run by node --test with Node's type stripping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countIn, countedText, format, neededCategories } from '../src/plural.ts';

test('a count is a number or a whole number formatted for the reader', () => {
  assert.equal(countIn(7), 7);
  assert.equal(countIn('1,234'), 1234);
  assert.equal(countIn('1 234'), 1234);
  assert.equal(countIn('12:30'), null);
  assert.equal(countIn('Anna'), null);
});

test('Polish picks one, few and many; the key itself is the fallback', () => {
  const bundle = { 'items.count': 'O', 'items.count.one': '1', 'items.count.few': 'F', 'items.count.many': 'M' };
  const rules = new Intl.PluralRules('pl-PL');
  assert.deepEqual([1, 2, 5, 22, 25].map((n) => countedText(bundle, 'items.count', [n], rules)), ['1', 'F', 'M', 'F', 'M']);
  assert.equal(countedText(bundle, 'items.count', ['x'], rules), undefined);
});

test('the forms a language needs come from its culture', () => {
  assert.deepEqual(neededCategories('en-GB'), ['one']);
  assert.deepEqual(neededCategories('pl-PL'), ['one', 'few', 'many']);
  assert.deepEqual(neededCategories('ja-JP'), []);
  assert.deepEqual(neededCategories('ar'), ['zero', 'one', 'two', 'few', 'many']);
});

test('placeholders are filled and numbers formatted for the culture', () => {
  assert.equal(format('{0} of {1}', [1234, 'x'], 'en-GB'), '1,234 of x');
  assert.equal(format('{0} items', [1234], 'nl-NL'), '1.234 items');
});
