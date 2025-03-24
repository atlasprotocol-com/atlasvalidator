const crypto = require('crypto');

const MAGIC_BYTES = Buffer.from('Bitcoin Signed Message:\n');

function varintBufNum(n) {
    let buf;
    if (n < 253) {
        buf = Buffer.alloc(1);
        buf.writeUInt8(n, 0);
    } else if (n < 0x10000) {
        buf = Buffer.alloc(1 + 2);
        buf.writeUInt8(253, 0);
        buf.writeUInt16LE(n, 1);
    } else if (n < 0x100000000) {
        buf = Buffer.alloc(1 + 4);
        buf.writeUInt8(254, 0);
        buf.writeUInt32LE(n, 1);
    } else {
        buf = Buffer.alloc(1 + 8);
        buf.writeUInt8(255, 0);
        buf.writeInt32LE(n & -1, 1);
        buf.writeUInt32LE(Math.floor(n / 0x100000000), 5);
    }
    return buf;
}

function doubleSha256(buffer) {
    return crypto.createHash('sha256').update(
        crypto.createHash('sha256').update(buffer).digest()
    ).digest();
}

function magicHash(message, messagePrefix) {
    const messagePrefixBuffer = messagePrefix ? Buffer.from(messagePrefix, "utf8") : MAGIC_BYTES;
    const prefix1 = varintBufNum(messagePrefixBuffer.length);
    const messageBuffer = Buffer.from(message);
    const prefix2 = varintBufNum(messageBuffer.length);
    const buf = Buffer.concat([prefix1, messagePrefixBuffer, prefix2, messageBuffer]);
    return doubleSha256(buf);
}

module.exports = { magicHash };
