import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { signedReadUrl } from '../src/oss.js';

test('updated mail and OSS dependencies construct offline messages and signed reads', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true });
  const mail = await transport.sendMail({ from: 'sender@example.test', to: 'reader@example.test',
    subject: '周边团登录验证码', text: 'Synthetic code: 123456', html: '<p>Synthetic code: 123456</p>' });
  assert.deepEqual(mail.envelope.to, ['reader@example.test']);
  assert.match(mail.message.toString(), /123456/);
  const url = new URL(signedReadUrl('guarded/post/synthetic/image.jpg', 60));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/guarded/post/synthetic/image.jpg');
  assert.ok(url.searchParams.get('Signature'));
  assert.ok(Number(url.searchParams.get('Expires')) > Date.now()/1000);
});
