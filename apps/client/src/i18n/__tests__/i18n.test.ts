/** @jest-environment jsdom */
/// <reference lib="dom" />
import { waitFor } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';

// Translation files served by the (mocked) network, keyed by URL.
const files: Record<string, Record<string, string>> = {
  '/locales/en/common.json': { greeting: 'Hello', onlyEnglish: 'English only', html: '{{value}}' },
  '/locales/en/search.json': { title: 'Search' },
  '/locales/en/booking.json': { title: 'Booking' },
  '/locales/en/payment.json': { title: 'Payment' },
  '/locales/fr/common.json': { greeting: 'Bonjour' },
  '/locales/fr/search.json': { title: 'Recherche' },
  '/locales/fr/booking.json': { title: 'Réservation' },
  '/locales/fr/payment.json': { title: 'Paiement' },
};

const fetchMock = jest.fn((url: string) => {
  const body = files[url];
  return Promise.resolve({
    ok: body !== undefined,
    status: body !== undefined ? 200 : 404,
    statusText: body !== undefined ? 'OK' : 'Not Found',
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
  });
});

const requestedUrls = () => fetchMock.mock.calls.map((call) => call[0]);

// Loads a fresh copy of the module (and of i18next) and waits for init to finish.
async function loadI18n(): Promise<I18n> {
  let instance: I18n | undefined;
  await jest.isolateModulesAsync(async () => {
    instance = (await import('../i18n')).default;
  });
  const i18n = instance as I18n;
  await waitFor(() => expect(i18n.isInitialized).toBe(true));
  return i18n;
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true, configurable: true });
});

beforeEach(() => {
  fetchMock.mockClear();
  localStorage.clear();
});

describe('i18n setup', () => {
  it('uses the locale stored under kayak_locale and loads its namespaces over HTTP', async () => {
    localStorage.setItem('kayak_locale', 'fr');
    const i18n = await loadI18n();

    expect(i18n.language).toBe('fr');
    expect(i18n.t('greeting')).toBe('Bonjour');
    expect(i18n.t('title', { ns: 'booking' })).toBe('Réservation');
    expect(requestedUrls()).toEqual(
      expect.arrayContaining([
        '/locales/fr/common.json',
        '/locales/fr/search.json',
        '/locales/fr/booking.json',
        '/locales/fr/payment.json',
        '/locales/en/common.json',
      ])
    );
  });

  it('falls back to English for keys missing in the active language', async () => {
    localStorage.setItem('kayak_locale', 'fr');
    const i18n = await loadI18n();
    expect(i18n.t('onlyEnglish')).toBe('English only');
  });

  it('uses the browser language when nothing is stored', async () => {
    const i18n = await loadI18n();
    expect(navigator.language).toBe('en-US');
    expect(i18n.resolvedLanguage).toBe('en');
    expect(i18n.t('greeting')).toBe('Hello');
  });

  it('ignores an unsupported stored locale', async () => {
    localStorage.setItem('kayak_locale', 'xx');
    const i18n = await loadI18n();
    expect(i18n.resolvedLanguage).toBe('en');
    expect(requestedUrls()).not.toContain('/locales/xx/common.json');
  });

  it('remembers a language change in localStorage', async () => {
    const i18n = await loadI18n();
    await i18n.changeLanguage('fr');
    expect(localStorage.getItem('kayak_locale')).toBe('fr');
    expect(i18n.t('title', { ns: 'search' })).toBe('Recherche');
  });

  it('is configured for the app namespaces, languages and React', async () => {
    const i18n = await loadI18n();
    const { options } = i18n;

    expect(options.defaultNS).toBe('common');
    expect(options.ns).toEqual(['common', 'search', 'booking', 'payment']);
    expect(options.fallbackLng).toEqual(['en']);
    expect(options.supportedLngs).toEqual(
      expect.arrayContaining(['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko'])
    );
    expect(options.react?.useSuspense).toBe(false);
  });

  it('does not HTML-escape interpolated values (React escapes them)', async () => {
    const i18n = await loadI18n();
    expect(i18n.t('html', { value: '<b>x</b>' })).toBe('<b>x</b>');
  });
});
