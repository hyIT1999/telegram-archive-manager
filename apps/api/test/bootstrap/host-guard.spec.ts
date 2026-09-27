import { describe, expect, it } from 'vitest';
import { allowedHostNames, hostNameOf, isAllowedHost } from '../../src/bootstrap/host-guard.js';

describe('hostNameOf', () => {
  it.each([
    ['archive.lan', 'archive.lan'],
    ['Archive.LAN:8080', 'archive.lan'],
    ['192.168.1.20:8080', '192.168.1.20'],
    ['[::1]:8080', '::1'],
    ['[FE80::1]', 'fe80::1'],
    ['localhost.', 'localhost'],
  ])('reads %j as %j', (header, host) => {
    expect(hostNameOf(header)).toBe(host);
  });

  it.each([
    undefined,
    '',
    'evil.example@localhost',
    'localhost/path',
    'localhost:8080:1',
    'local host',
    '[not-an-ip]:80',
    '[::1',
  ])('refuses %j', (header) => {
    expect(hostNameOf(header)).toBeNull();
  });
});

describe('isAllowedHost', () => {
  const allowed = allowedHostNames({
    ALLOWED_HOSTS: ['archive.lan', '*.example.com'],
    CSRF_TRUSTED_ORIGINS: ['http://nas.local:8080', 'https://Photos.Example.org'],
  });

  it('always answers IP addresses and localhost', () => {
    for (const header of ['127.0.0.1:3100', '192.168.1.20', '[::1]:8080', 'localhost:4300']) {
      expect(isAllowedHost(header, [])).toBe(true);
    }
    expect(isAllowedHost('app.localhost:8080', [])).toBe(true);
  });

  it('answers the names of ALLOWED_HOSTS and of the trusted origins', () => {
    expect(allowed).toEqual(['archive.lan', '*.example.com', 'nas.local', 'photos.example.org']);
    for (const header of [
      'archive.lan:8080',
      'ARCHIVE.lan',
      'nas.local:8080',
      'photos.example.org',
      'media.example.com',
      'a.b.example.com:443',
    ]) {
      expect(isAllowedHost(header, allowed)).toBe(true);
    }
  });

  it('refuses any other name, including look-alikes of an allowed one', () => {
    for (const header of [
      'evil.example',
      'archive.lan.evil.example',
      'example.com',
      'notexample.com',
      'localhost.evil.example',
      undefined,
    ]) {
      expect(isAllowedHost(header, allowed)).toBe(false);
    }
  });
});
