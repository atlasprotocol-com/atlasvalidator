const { base_decode } = require("near-api-js/lib/utils/serialize");
const { ec: EC } = require("elliptic");
const hash = require("hash.js");
const bs58check = require("bs58check");
const crypto = require("crypto");
const { bech32 } = require("bech32");
const { createHash } = require("crypto");
const { keccak256 } = require("viem");
const BN = require("bn.js");

const EPSILON_DERIVATION_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation";
const secp256k1 = new EC("secp256k1");
const ec = new EC("secp256k1");

async function najPublicKeyStrToUncompressedHexPoint(rootPublicKey) {
  
  const res = '04' + Buffer.from(base_decode(rootPublicKey.split(':')[1])).toString('hex');
  console.log(res);
  return res;
}

async function deriveChildPublicKey(
  parentUncompressedPublicKeyHex,
  signerId,
  path = "",
) {
 ;

  const scalarHex = deriveEpsilon(signerId, path);

  const x = parentUncompressedPublicKeyHex.substring(2, 66);
  const y = parentUncompressedPublicKeyHex.substring(66);

  // Create a point object from X and Y coordinates
  const oldPublicKeyPoint = secp256k1.curve.point(x, y);

  // Multiply the scalar by the generator point G
  const scalarTimesG = secp256k1.g.mul(scalarHex);

  // Add the result to the old public key point
  const newPublicKeyPoint = oldPublicKeyPoint.add(scalarTimesG);
  const newX = newPublicKeyPoint.getX().toString("hex").padStart(64, "0");
  const newY = newPublicKeyPoint.getY().toString("hex").padStart(64, "0");
  return "04" + newX + newY;
}

function deriveEpsilon(predecessorId, path) {
  const derivationPath = `${EPSILON_DERIVATION_PREFIX}:${predecessorId},${path}`;

  // Create a SHA3-256 hash of the derivation path
  const hasher = createHash("sha3-256");
  hasher.update(derivationPath);
  const hash = hasher.digest();

  // Convert the hash to a Scalar and extract the private key
  const scalar = secp256k1.keyFromPrivate(hash, "hex");
  const hashBuffer = scalar.getPrivate().toArray("be", 32);

  // Convert and return hex representation.
  return hashBuffer.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uncompressedHexPointToEvmAddress(uncompressedHexPoint) {
  const addressHash = keccak256(`0x${uncompressedHexPoint.slice(2)}`);
  // Ethereum address is last 20 bytes of hash (40 characters), prefixed with 0x
  return "0x" + addressHash.substring(addressHash.length - 40);
}

async function uncompressedHexPointToBtcAddress(publicKeyHex, network) {
  // Step 1: SHA-256 hashing of the public key
  const publicKeyBytes = Uint8Array.from(Buffer.from(publicKeyHex, "hex"));

  const sha256HashOutput = await crypto.subtle.digest(
    "SHA-256",
    publicKeyBytes,
  );

  // Step 2: RIPEMD-160 hashing on the result of SHA-256
  const ripemd160 = hash
    .ripemd160()
    .update(Buffer.from(sha256HashOutput))
    .digest();

  // Step 3: Adding network byte (0x00 for Bitcoin Mainnet)
  const network_byte = network === "bitcoin" ? 0x00 : 0x6f;
  const networkByte = Buffer.from([network_byte]);
  const networkByteAndRipemd160 = Buffer.concat([
    networkByte,
    Buffer.from(ripemd160),
  ]);

  // Step 4: Base58Check encoding
  const address = bs58check.encode(networkByteAndRipemd160);

  return address;
}

async function derivep2wpkhChildPublicKey(
  parentUncompressedPublicKeyHex,
  signerId,
  path = ''
) {
  const scalar = deriveEpsilon(signerId, path);

  const x = parentUncompressedPublicKeyHex.substring(2, 66);
  const y = parentUncompressedPublicKeyHex.substring(66);

  // Create a point object from X and Y coordinates
  const oldPublicKeyPoint = secp256k1.curve.point(x, y);

  // Multiply the scalar by the generator point G
  const scalarTimesG = secp256k1.g.mul(scalar);

  // Add the result to the old public key point
  const newPublicKeyPoint = oldPublicKeyPoint.add(scalarTimesG);

  // Get the compressed public key
  const compressedPublicKey = newPublicKeyPoint.encode('hex', true);
  
  return compressedPublicKey;
}

async function uncompressedHexPointToSegwitAddress(publicKeyHex, network) {
  const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
  const sha256HashOutput = crypto.createHash('sha256').update(publicKeyBuffer).digest();
  const ripemd160HashOutput = crypto.createHash('ripemd160').update(sha256HashOutput).digest();

  const words = bech32.toWords(ripemd160HashOutput);
  words.unshift(0x00); // Add the witness version (0x00 for P2WPKH)

  const prefix = network === 'bitcoin' ? 'bc' : 'tb';
  const segwitAddress = bech32.encode(prefix, words);

  return segwitAddress;
}

module.exports = {
  najPublicKeyStrToUncompressedHexPoint,
  deriveChildPublicKey,
  uncompressedHexPointToEvmAddress,
  uncompressedHexPointToBtcAddress,
  uncompressedHexPointToSegwitAddress,
  derivep2wpkhChildPublicKey,
};
