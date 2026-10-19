export type HexChecksum = "none" | "sum8" | "xor8" | "crc16-modbus" | "crc16-ccitt" | "crc32" | "sum16";

function parseHex(input: string): number[] {
  const compact = input.replace(/0x/gi, "").replace(/[\s,;:_-]+/g, "");
  if (!compact) return [];
  if (!/^[0-9a-f]+$/i.test(compact) || compact.length % 2 !== 0) {
    throw new Error("Hex 必须是偶数位十六进制字节");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset < compact.length; offset += 2) {
    bytes.push(Number.parseInt(compact.slice(offset, offset + 2), 16));
  }
  return bytes;
}

function formatHex(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).padStart(2, "0")).join(" ");
}

function crc16Modbus(bytes: number[]): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

function crc16Ccitt(bytes: number[]): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

export interface ChecksumRange { start: number; end?: number }

export function appendHexChecksum(input: string, checksum: HexChecksum, range?: ChecksumRange): string {
  const bytes = parseHex(input);
  if (checksum === "none") return formatHex(bytes);
  if (bytes.length === 0) throw new Error("添加校验和前请先输入 Hex 数据");
  const start = range?.start ?? 0, end = range?.end ?? bytes.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > bytes.length || start >= end) {
    throw new Error("校验范围必须位于数据内，且起始字节不能晚于结束字节");
  }
  const checked = bytes.slice(start, end);
  if (checksum === "sum8") {
    bytes.push(checked.reduce((sum, value) => (sum + value) & 0xff, 0));
  } else if (checksum === "xor8") {
    bytes.push(checked.reduce((value, byte) => value ^ byte, 0));
  } else if (checksum === "crc16-modbus") {
    const crc = crc16Modbus(checked);
    bytes.push(crc & 0xff, (crc >>> 8) & 0xff);
  } else if (checksum === "crc16-ccitt") {
    const crc = crc16Ccitt(checked);
    bytes.push((crc >>> 8) & 0xff, crc & 0xff);
  } else if (checksum === "sum16") {
    const sum = checked.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
    bytes.push(sum & 0xff, sum >>> 8);
  } else if (checksum === "crc32") {
    let crc = 0xffffffff;
    for (const byte of checked) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    bytes.push(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24);
  }
  return formatHex(bytes);
}

export function checksumLabel(checksum: HexChecksum): string {
  switch (checksum) {
    case "sum16":
      return "SUM16（低字节在前）";
    case "crc32":
      return "CRC32/ISO-HDLC（低字节在前）";
    case "sum8":
      return "SUM8（低 8 位）";
    case "xor8":
      return "XOR8";
    case "crc16-modbus":
      return "CRC16-Modbus（低字节在前）";
    case "crc16-ccitt":
      return "CRC16-CCITT（高字节在前）";
    default:
      return "不添加校验";
  }
}
