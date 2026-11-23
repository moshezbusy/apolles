import { describe, expect, it } from 'vitest';
import { redactHeaders, redactText } from '../src/security/redact.js';

describe('redaction', () => {
  it('masks card numbers, CVV, passwords in XML attributes and elements', () => {
    const xml = '<RequestorID ID="apolles" MessagePassword="s3cret"/><PaymentCard CardCode="VI" CardNumber="4111111111111111" ExpireDate="1228" SeriesCode="123"/><Password>abc</Password>';
    const out = redactText(xml);
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('4111111111111111');
    expect(out).not.toContain('"123"');
    expect(out).not.toContain('>abc<');
    expect(out).toContain('ID="apolles"');
  });
  it('masks card numbers in free text but keeps non-card digit runs', () => {
    expect(redactText('card 4111 1111 1111 1111 ok')).toBe('card ***1111 ok');
    expect(redactText('ref 1234567890123')).toBe('ref 1234567890123');
  });
  it('masks JSON and query secrets', () => {
    expect(redactText('{"password":"x","cvv":123}')).toBe('{"password":"***","cvv":"***"}');
    expect(redactText('https://x/a?token=abc&b=1')).toBe('https://x/a?token=***&b=1');
  });
  it('masks auth headers', () => {
    expect(redactHeaders({ Authorization: 'Basic abc', 'content-type': 'x' })).toEqual({ Authorization: '***', 'content-type': 'x' });
  });
  it('masks the other spellings of the card security code', () => {
    const out = redactText('{"cardCVC":"737","CVV2":"123","CardSecurityCode":456,"cardNumber":"x"}');
    expect(out).toBe('{"cardCVC":"***","CVV2":"***","CardSecurityCode":"***","cardNumber":"***"}');
    expect(redactText('<Card CardSecurityCode="737" CVV2="123"/>')).not.toMatch(/737|123/);
    expect(redactText('<cardCVC>737</cardCVC>')).toBe('<cardCVC>***</cardCVC>');
  });
  it('masks card numbers written with dots', () => {
    expect(redactText('card 4111.1111.1111.1111 ok')).toBe('card ***1111 ok');
    expect(redactText('amex 3782.822463.10005')).toBe('amex ***0005');
    // prices and dates are left alone
    expect(redactText('total 300.00 then 360.50 on 2027.03.01')).toBe('total 300.00 then 360.50 on 2027.03.01');
  });
  it('masks more auth headers', () => {
    expect(redactHeaders({ 'X-Auth-Token': 'a', 'Ocp-Apim-Subscription-Key': 'b', 'x-api-secret': 'c', accept: 'json' }))
      .toEqual({ 'X-Auth-Token': '***', 'Ocp-Apim-Subscription-Key': '***', 'x-api-secret': '***', accept: 'json' });
  });
});
