//#endregion
//#region src/bytes/advanced.d.ts
/**
 * Represents the possible encoding formats for converting bytes.
 * @public
 */
type BytesFromEncoding = "utf8" | "utf16le" | "latin1" | "base64" | "base64url" | "hex" | "ascii" | "binary" | "ucs2";
//#endregion
//#region src/bytes/index.d.ts
/**
 * @public
 */
type Bytes$1 = Uint8Array;
/**
 * @public
 */
declare const Bytes$1: Uint8ArrayConstructor;
/**
 * @public
 */
type BytesLike = string | Uint8Array | ArrayBuffer | ArrayLike<number>;
/**
 * Concatenates multiple byte-like arrays to the first number array.
 * @public
 *
 * @param result - The number array as result
 * @param args - The byte-like arrays to concatenate.
 * @returns The first number array
 *
 * @example
 * ```typescript
 * const concatenatedBytes = [1, 2];
 * bytesConcatTo(
 *   concatenatedBytes
 *   new Uint8Array([3, 4]),
 *   "hello",
 *   [5, 6, 7]
 * );
 * console.log(concatenatedBytes); // Outputs [1, 2, 3, 4, /* bytes of "hello" *\/, 5, 6, 7]
 * ```
 */
declare function bytesConcatTo(result: number[], ...args: BytesLike[]): number[];
/**
 * Concatenates multiple byte-like arrays into a single byte array.
 * @public
 *
 * @param args - The byte-like arrays to concatenate.
 * @returns A Uint8Array containing the concatenated bytes.
 *
 * @example
 * ```typescript
 * const concatenatedBytes = bytesConcat(
 *   new Uint8Array([1, 2]),
 *   new Uint8Array([3, 4]),
 *   "hello",
 *   [5, 6, 7]
 * );
 * console.log(concatenatedBytes); // Outputs Uint8Array [1, 2, 3, 4, /* bytes of "hello" *\/, 5, 6, 7]
 * ```
 */
declare function bytesConcat(...args: BytesLike[]): Bytes$1;
/**
 * Converts a byte-like value to a string using the specified encoding.
 * @public
 *
 * @param val - The byte-like value to convert.
 * @param encoding - The encoding to use for the conversion, as defined by the BytesFromEncoding type.
 * @returns A string representing the encoded bytes.
 *
 * @example
 * ```typescript
 * const encodedString = bytesTo(new Uint8Array([104, 101, 108, 108, 111]), "utf8");
 * console.log(encodedString); // Outputs "hello"
 *
 * const base64String = bytesTo(new Uint8Array([104, 101, 108, 108, 111]), "base64");
 * console.log(base64String); // Outputs "aGVsbG8="
 * ```
 */
declare function bytesTo(val: BytesLike, encoding: BytesFromEncoding): string;
/**
 * Converts various types of byte-like values to a Uint8Array.
 * @public
 *
 * @param bytes - The byte-like value to convert. It can be a string, Uint8Array, ArrayBuffer, or number array.
 * @param encoding - Optional encoding to use if the input is a string. Defaults to hexadecimal if not specified.
 * @returns A Uint8Array representing the input bytes.
 *
 * @throws Will throw an error if the input bytes are invalid or out of range.
 *
 * @example
 * ```typescript
 * const bytes1 = bytesFrom(new Uint8Array([1, 2, 3]));
 * console.log(bytes1); // Outputs Uint8Array [1, 2, 3]
 *
 * const bytes2 = bytesFrom("68656c6c6f", "hex");
 * console.log(bytes2); // Outputs Uint8Array [104, 101, 108, 108, 111]
 *
 * const bytes3 = bytesFrom("hello", "utf8");
 * console.log(bytes3); // Outputs Uint8Array [104, 101, 108, 108, 111]
 *
 * const bytes4 = bytesFrom([1, 2, 255]);
 * console.log(bytes4); // Outputs Uint8Array [1, 2, 255]
 * ```
 */
declare function bytesFrom(bytes: BytesLike, encoding?: BytesFromEncoding): Bytes$1;
/**
 * Compares two byte-like values for equality.
 * @public
 *
 * @param a - The first byte-like value to compare.
 * @param b - The second byte-like value to compare.
 * @returns A boolean indicating whether the two byte-like values are equal.
 *
 * @example
 * ```typescript
 * bytesEq([1], Uint8Array.from([1])) // true
 * ```
 */
declare function bytesEq(a: BytesLike, b: BytesLike): boolean;
//#endregion
//#region src/hex/index.d.ts
/**
 * Represents a hexadecimal string prefixed with "0x".
 * @public
 */
type Hex = `0x${string}`;
/**
 * Represents a value that can be converted to a hexadecimal string.
 * It extends the BytesLike type.
 * @public
 */
type HexLike = BytesLike;
/**
 * Returns the hexadecimal representation of the given value.
 *
 * @param hex - The value to convert, which can be a string, Uint8Array, ArrayBuffer, or number array.
 * @returns A Hex string representing the value.
 *
 * @example
 * ```typescript
 * const hexString = hexFrom("68656c6c6f"); // Outputs "0x68656c6c6f"
 * const hexStringFromBytes = hexFrom(new Uint8Array([104, 101, 108, 108, 111])); // Outputs "0x68656c6c6f"
 * ```
 */
declare function hexFrom(hex: HexLike): Hex;
/**
 * Return the number of bytes occupied by `hexLike`.
 *
 * @param hexLike - Hex-like value
 * @returns Byte length of `hexLike`.
 *
 * @example
 * ```typescript
 * bytesLen("0x48656c6c6f") // 5
 * bytesLen(new Uint8Array([1, 2, 3])) // 3
 * bytesLen(new ArrayBuffer(4)) // 4
 * bytesLen([1, 2]) // 2
 * ```
 *
 * @see bytesLenUnsafe - Fast version for already-normalized Hex strings
 *
 * @note Prefer direct `.length`/`.byteLength` access on Uint8Array/ArrayBuffer when you already have bytes.
 *       Use `bytesLen()` only when you need length without performing additional operations.
 * @see bytesFrom - Convert values to Bytes (Uint8Array)
 */
declare function bytesLen(hexLike: HexLike): number;
/**
 * Fast byte length for Hex strings.
 *
 * This function efficiently calculates the byte length of Hex values:
 * - Skips validation (caller must ensure input is valid Hex)
 * - Handles odd-digit hex as if it were padded with a leading zero (e.g., "0x123" is treated as "0x0123").
 *
 * @param hex - A valid Hex string (with "0x" prefix).
 * @returns Byte length of the hex string.
 *
 * @example
 * ```typescript
 * bytesLenUnsafe("0x48656c6c6f") // 5
 * bytesLenUnsafe("0x123") // 2 (odd digits round up via padding)
 * ```
 *
 * @see bytesLen - Validated version for untrusted input
 */
declare function bytesLenUnsafe(hex: Hex): number;
//#endregion
//#region src/address/index.d.ts
/**
 * @public
 */
type AddressLike = {
  script: ScriptLike;
  prefix: string;
};
/**
 * Represents a ckb address with associated script and prefix.
 * @public
 */
declare class Address {
  script: Script;
  prefix: string;
  /**
   * Creates an instance of Address.
   *
   * @param script - The script associated with the address.
   * @param prefix - The address prefix.
   */
  constructor(script: Script, prefix: string);
  /**
   * Creates an Address instance from an AddressLike object.
   *
   * @param address - An AddressLike object or an instance of Address.
   * @returns An Address instance.
   */
  static from(address: AddressLike): Address;
  /**
   * Creates an Address instance from an address string.
   *
   * @param address - The address string to parse.
   * @param clients - A Client instance or a record of Client instances keyed by prefix.
   * @returns A promise that resolves to an Address instance.
   *
   * @throws Will throw an error if the address prefix is unknown or mismatched.
   */
  static fromString(address: string, clients: Client | Record<string, Client>): Promise<Address>;
  /**
   * Creates an Address instance from a script and client.
   *
   * @param script - The script-like object.
   * @param client - The client instance used to fetch the address prefix.
   * @returns A promise that resolves to an Address instance.
   */
  static fromScript(script: ScriptLike, client: Client): Address;
  static fromKnownScript(client: Client, script: KnownScript, args: HexLike): Promise<Address>;
  /**
   * Converts the Address instance to a string.
   *
   * @returns The address as a string.
   */
  toString(): string;
}
//#endregion
//#region src/codec/codec.d.ts
type CodecLike<Encodable, Decoded = Encodable> = {
  readonly encode: (encodable: Encodable) => Bytes$1;
  readonly decode: (decodable: BytesLike, config?: {
    isExtraFieldIgnored?: boolean;
  }) => Decoded;
  readonly byteLength?: number;
};
declare class Codec<Encodable, Decoded = Encodable> {
  readonly encode: (encodable: Encodable) => Bytes$1;
  readonly decode: (decodable: BytesLike, config?: {
    isExtraFieldIgnored?: boolean;
  }) => Decoded;
  readonly byteLength?: number | undefined;
  constructor(encode: (encodable: Encodable) => Bytes$1, decode: (decodable: BytesLike, config?: {
    isExtraFieldIgnored?: boolean;
  }) => Decoded, byteLength?: number | undefined);
  encodeOr<T>(encodable: Encodable, fallback: T): Bytes$1 | T;
  decodeOr<T>(decodable: BytesLike, fallback: T, config?: {
    isExtraFieldIgnored?: boolean;
  }): Decoded | T;
  static from<Encodable, Decoded = Encodable>({
    encode,
    decode,
    byteLength
  }: CodecLike<Encodable, Decoded>): Codec<Encodable, Decoded>;
  map<NewEncodable = Encodable, NewDecoded = Decoded>({
    inMap,
    outMap
  }: {
    inMap?: (encodable: NewEncodable) => Encodable;
    outMap?: (decoded: Decoded) => NewDecoded;
  }): Codec<NewEncodable, NewDecoded>;
  mapIn<NewEncodable>(map: (encodable: NewEncodable) => Encodable): Codec<NewEncodable, Decoded>;
  mapOut<NewDecoded>(map: (decoded: Decoded) => NewDecoded): Codec<Encodable, NewDecoded>;
}
type EncodableType<T extends CodecLike<any, any>> = T extends CodecLike<infer Encodable, unknown> ? Encodable : never;
type DecodedType<T extends CodecLike<any, any>> = T extends CodecLike<any, infer Decoded> ? Decoded : never;
//#endregion
//#region src/num/index.d.ts
/**
 * Represents a numeric value as a bigint.
 * @public
 */
type Num = bigint;
/**
 * Represents a value that can be converted to a numeric value.
 * It can be a string, number, bigint, or HexLike.
 * @public
 */
type NumLike = string | number | bigint | HexLike;
/**
 * Get the min among all numbers.
 * @public
 *
 * @param numbers - numbers.
 * @returns The min numbers among them.
 *
 * @example
 * ```typescript
 * numMin(1, 2, 3); // Outputs 1n
 * ```
 */
declare function numMin(a: NumLike, ...numbers: NumLike[]): Num;
/**
 * Get the max among all numbers.
 * @public
 *
 * @param numbers - numbers.
 * @returns The max numbers among them.
 *
 * @example
 * ```typescript
 * numMax(1, 2, 3); // Outputs 3n
 * ```
 */
declare function numMax(a: NumLike, ...numbers: NumLike[]): Num;
/**
 * Converts a NumLike value to a Num (bigint).
 * @public
 *
 * @param val - The value to convert, which can be a string, number, bigint, or HexLike.
 * @returns A Num (bigint) representing the value.
 *
 * @example
 * ```typescript
 * const num = numFrom("12345"); // Outputs 12345n
 * const numFromHex = numFrom("0x3039"); // Outputs 12345n
 * ```
 */
declare function numFrom(val: NumLike): Num;
/**
 * Converts a {@link NumLike} value into its hexadecimal string representation, prefixed with `0x`.
 *
 * @remarks
 * This function returns the direct hexadecimal representation of the number, which may have an odd number of digits.
 * For a full-byte representation (an even number of hex digits), consider using {@link numToBytes}, {@link numLeToBytes}, or {@link numBeToBytes} and then converting the resulting byte array to a hex string.
 *
 * @public
 *
 * @param val - The value to convert, which can be a string, number, bigint, or HexLike.
 * @returns A Hex string representing the number.
 *
 * @throws {Error} If the normalized numeric value is negative.
 *
 * @example
 * ```typescript
 * const hex = numToHex(4660); // "0x1234"
 * const oddLengthHex = numToHex(10); // "0xa"
 * ```
 */
declare function numToHex(val: NumLike): Hex;
/**
 * Converts a NumLike value to a byte array in little-endian order.
 * @public
 *
 * @param val - The value to convert, which can be a string, number, bigint, or HexLike.
 * @param bytes - The number of bytes to use for the representation. If not provided, the exact number of bytes needed is used.
 * @returns A Uint8Array containing the byte representation of the numeric value.
 *
 * @example
 * ```typescript
 * const bytes = numToBytes(12345, 4); // Outputs Uint8Array [57, 48, 0, 0]
 * ```
 */
declare function numToBytes(val: NumLike, bytes?: number): Bytes$1;
/**
 * Converts a NumLike value to a byte array in little-endian order.
 * @public
 *
 * @param val - The value to convert, which can be a string, number, bigint, or HexLike.
 * @param bytes - The number of bytes to use for the representation. If not provided, the exact number of bytes needed is used.
 * @returns A Uint8Array containing the byte representation of the numeric value.
 *
 * @example
 * ```typescript
 * const bytes = numLeToBytes(12345, 4); // Outputs Uint8Array [57, 48, 0, 0]
 * ```
 */
declare function numLeToBytes(val: NumLike, bytes?: number): Bytes$1;
/**
 * Converts a NumLike value to a byte array in big-endian order.
 * @public
 *
 * @param val - The value to convert, which can be a string, number, bigint, or HexLike.
 * @param bytes - The number of bytes to use for the representation. If not provided, the exact number of bytes needed is used.
 * @returns A Uint8Array containing the byte representation of the numeric value.
 *
 * @example
 * ```typescript
 * const bytes = numBeToBytes(12345, 4); // Outputs Uint8Array [0, 0, 48, 57]
 * ```
 */
declare function numBeToBytes(val: NumLike, bytes?: number): Bytes$1;
/**
 * Converts a byte array to a Num (bigint) assuming little-endian order.
 * @public
 *
 * @param val - The byte array to convert.
 * @returns A Num (bigint) representing the numeric value.
 *
 * @example
 * ```typescript
 * const num = numFromBytes(new Uint8Array([57, 48, 0, 0])); // Outputs 12345n
 * ```
 */
declare function numFromBytes(val: BytesLike): Num;
/**
 * Converts a byte array to a Num (bigint) assuming little-endian order.
 * @public
 *
 * @param val - The byte array to convert.
 * @returns A Num (bigint) representing the numeric value.
 *
 * @example
 * ```typescript
 * const num = numLeFromBytes(new Uint8Array([57, 48, 0, 0])); // Outputs 12345n
 * ```
 */
declare function numLeFromBytes(val: BytesLike): Num;
/**
 * Converts a byte array to a Num (bigint) assuming big-endian order.
 * @public
 *
 * @param val - The byte array to convert.
 * @returns A Num (bigint) representing the numeric value.
 *
 * @example
 * ```typescript
 * const num = numBeFromBytes(new Uint8Array([0, 0, 48, 57])); // Outputs 12345n
 * ```
 */
declare function numBeFromBytes(val: BytesLike): Num;
//#endregion
//#region src/utils/index.d.ts
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: undefined): undefined;
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: null): undefined;
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: T): R;
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: T | undefined): R | undefined;
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: T | null): R | undefined;
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: undefined | null): undefined;
/**
/**
 * A type safe way to apply a transformer on a value if it's not empty.
 * @public
 *
 * @param transformer - The transformer.
 * @param value - The value to be transformed.
 * @returns If the value is empty, it becomes undefined. Otherwise it will be transformed.
 */
declare function apply<T, R>(transformer: (val: T) => R, value: T | undefined | null): R | undefined;
/**
 * Similar to Array.reduce, but the accumulator can returns Promise.
 * @public
 *
 * @param values - The array to be reduced.
 * @param accumulator - A callback to be called for each value. If it returns null, the previous result will be kept.
 * @returns The accumulated result.
 */
declare function reduceAsync<T>(values: T[], accumulator: (a: T, b: T) => Promise<T | undefined | null | void> | T | undefined | null | void): Promise<T>;
/**
 * Similar to Array.reduce, but the accumulator can returns Promise.
 * @public
 *
 * @param values - The array to be reduced.
 * @param accumulator - A callback to be called for each value. If it returns null, the previous result will be kept.
 * @param init - The initial value.
 * @returns The accumulated result.
 */
declare function reduceAsync<T, V>(values: V[], accumulator: (a: T, b: V, i: number, values: V[]) => Promise<T | undefined | null | void> | T | undefined | null | void, init: T | Promise<T>): Promise<T>;
declare function sleep(ms: NumLike): Promise<unknown>;
type Constructor<T, Args extends any[] = any[]> = {
  new (...args: Args): T;
};
/**
 * @public
 */
declare function isWebview(userAgent: string): boolean;
/**
 * @public
 */
declare function stringify(val: unknown): string;
/**
 * Calculate the greatest common divisor (GCD) of two NumLike values using the Euclidean algorithm.
 *
 * @param a - First operand.
 * @param b - Second operand.
 * @returns GCD(a, b) as a Num.
 */
declare function gcd(a: NumLike, b: NumLike): Num;
//#endregion
//#region src/codec/entity.d.ts
/**
 * The base class of CCC to create a serializable instance. This should be used with the {@link codec} decorator.
 * @public
 */
declare abstract class Entity {
  /**
   * Generate a base class of CCC to create a serializable instance.
   * This should be used with the {@link codec} decorator.
   * @public
   */
  static Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    /**
     * Convert the entity to bytes
     * @public
     * @returns The bytes representation of the entity
     */
    toBytes(): Bytes$1;
    /**
     * Create a clone of the entity
     * @public
     * @returns A clone of the entity
     */
    clone(): SubType;
    /**
     * Check if the entity is equal to another entity
     * @public
     * @param other - The other entity to compare with
     * @returns True if the entities are equal, false otherwise
     */
    eq(other: SubTypeLike): boolean;
    /**
     * Calculate the hash of the entity
     * @public
     * @returns The hash of the entity
     */
    hash(): Hex;
    /**
     * Convert the entity to a full-byte untrimmed Hex representation
     * @public
     * @returns The entity full-byte untrimmed hexadecimal representation
     */
    toHex(): Hex;
  }) & {
    /**
     * The bytes length of the entity, if it is fixed, otherwise undefined
     * @public
     * @static
     */
    byteLength?: number;
    /**
     * Encode the entity into bytes
     * @public
     * @static
     * @param _ - The entity to encode
     * @returns The encoded bytes
     * @throws Will throw an error if the entity is not serializable
     */
    encode(_: SubTypeLike): Bytes$1;
    /**
     * Decode the entity from bytes
     * @public
     * @static
     * @param _ - The bytes to decode
     * @returns The decoded entity
     * @throws Will throw an error if the entity is not serializable
     */
    decode(_: BytesLike): SubType;
    /**
     * Create an entity from bytes
     * @public
     * @static
     * @param _ - The bytes to create the entity from
     * @returns The created entity
     * @throws Will throw an error if the entity is not serializable
     */
    fromBytes(_bytes: BytesLike): SubType;
    /**
     * Create an entity from a serializable object
     * @public
     * @static
     * @param _ - The serializable object to create the entity from
     * @returns The created entity
     * @throws Will throw an error if the entity is not serializable
     */
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
  abstract toBytes(): Bytes$1;
  abstract hash(): Hex;
  abstract toHex(): Hex;
  abstract clone(): Entity;
}
/**
 * A class decorator to add methods implementation on the {@link Entity.Base} class
 * @example
 * ```typescript
 * @codec(
 *   mol.table({
 *     codeHash: mol.Byte32,
 *     hashType: HashTypeCodec,
 *     args: mol.Bytes,
 *   }),
 * )
 * export class Script extends Entity.Base<ScriptLike, Script>() {
 *   from(scriptLike: ScriptLike): Script {}
 * }
 * ```
 */
declare function codec<Encodable, TypeLike extends Encodable, Decoded extends TypeLike>(codec: {
  encode: (encodable: Encodable) => Bytes$1;
  decode: (decodable: Bytes$1, config?: {
    isExtraFieldIgnored?: boolean;
  }) => Decoded;
  byteLength?: number;
}): <Type extends TypeLike, ConstructorType extends Constructor<Type> & {
  from(decoded: TypeLike): Type;
  byteLength?: number;
  encode(encodable: TypeLike): Bytes$1;
  decode(bytesLike: BytesLike): Type;
  fromBytes(bytes: BytesLike): Type;
}>(Constructor: ConstructorType, ..._: unknown[]) => ConstructorType;
//#endregion
//#region src/codec/predefined.d.ts
/**
 * Create a codec to deal with fixed LE or BE bytes.
 * @param byteLength
 * @param littleEndian
 */
declare function codecUint(byteLength: number, littleEndian?: boolean): Codec<NumLike, Num>;
/**
 * Create a codec to deal with fixed LE or BE bytes.
 * @param byteLength
 * @param littleEndian
 */
declare function codecUintNumber(byteLength: number, littleEndian?: boolean): Codec<NumLike, number>;
/**
 * Create a codec for padding bytes.
 * The padding bytes are zero-filled when encoding and ignored when decoding.
 * @param byteLength The length of the padding in bytes.
 */
declare function codecPadding(byteLength: number): Codec<void | undefined | null, void>;
declare const CodecRaw: Codec<BytesLike, Bytes$1>;
declare const CodecBytes: Codec<HexLike, Hex>;
declare const CodecUint8: Codec<NumLike, number>;
declare const CodecUint16LE: Codec<NumLike, number>;
declare const CodecUint16BE: Codec<NumLike, number>;
declare const CodecUint16: Codec<NumLike, number>;
declare const CodecUint32LE: Codec<NumLike, number>;
declare const CodecUint32BE: Codec<NumLike, number>;
declare const CodecUint32: Codec<NumLike, number>;
declare const CodecUint64LE: Codec<NumLike, bigint>;
declare const CodecUint64BE: Codec<NumLike, bigint>;
declare const CodecUint64: Codec<NumLike, bigint>;
declare const CodecUint128LE: Codec<NumLike, bigint>;
declare const CodecUint128BE: Codec<NumLike, bigint>;
declare const CodecUint128: Codec<NumLike, bigint>;
declare const CodecUint256LE: Codec<NumLike, bigint>;
declare const CodecUint256BE: Codec<NumLike, bigint>;
declare const CodecUint256: Codec<NumLike, bigint>;
declare const CodecUint512LE: Codec<NumLike, bigint>;
declare const CodecUint512BE: Codec<NumLike, bigint>;
declare const CodecUint512: Codec<NumLike, bigint>;
declare const CodecBool: Codec<boolean>;
declare const CodecByte: Codec<HexLike, Hex>;
declare const CodecByte4: Codec<HexLike, Hex>;
declare const CodecByte8: Codec<HexLike, Hex>;
declare const CodecByte16: Codec<HexLike, Hex>;
declare const CodecByte32: Codec<HexLike, Hex>;
//#endregion
//#region src/fixedPoint/index.d.ts
/**
 * Represents a fixed point value as a bigint.
 * @public
 */
type FixedPoint = bigint;
/**
 * Represents a value that can be converted to a fixed point value.
 * It can be a bigint, string, or number.
 * @public
 */
type FixedPointLike = bigint | string | number;
/**
 * Converts a FixedPointLike value to its string representation with fixed-point decimals.
 * @public
 *
 * @param val - The value to convert, which can be a bigint, string, or number.
 * @param decimals - The number of decimal places for the fixed-point representation. Default is 8.
 * @returns A string representing the fixed-point value.
 *
 * @example
 * ```typescript
 * const str = fixedPointToString(123456789n, 8); // Outputs "1.23456789"
 * const strFromString = fixedPointToString("1.23456789", 8); // Outputs "1.23456789"
 * const strFromNumber = fixedPointToString(1.23456789, 8); // Outputs "1.23456789"
 * ```
 */
declare function fixedPointToString(val: FixedPointLike, decimals?: number): string;
/**
 * Converts a FixedPointLike value to a FixedPoint (bigint) with fixed-point decimals.
 * @public
 *
 * @param val - The value to convert, which can be a bigint, string, or number.
 * @param decimals - The number of decimal places for the fixed-point representation. Default is 8.
 * @returns A FixedPoint (bigint) representing the value with fixed-point decimals.
 *
 * @example
 * ```typescript
 * const fixedPoint = fixedPointFrom(123456789n, 8); // Outputs 123456789n
 * const fixedPointFromString = fixedPointFrom("1.23456789", 8); // Outputs 123456789n
 * const fixedPointFromNumber = fixedPointFrom(1.23456789, 8); // Outputs 123456789n
 * ```
 */
declare function fixedPointFrom(val: FixedPointLike, decimals?: number): FixedPoint;
/**
 * Represents the fixed point value of zero as a bigint.
 * @public
 */
declare const Zero: FixedPoint;
/**
 * Represents the fixed point value of one as a FixedPoint (bigint).
 * Equivalent to 1 in fixed-point representation with default decimals (8).
 * @public
 */
declare const One: FixedPoint;
//#endregion
//#region src/hasher/hasher.d.ts
/**
 * @public
 */
interface Hasher {
  /**
   * Updates the hash with the given data.
   *
   * @param data - The data to update the hash with.
   * @returns The current Hasher instance for chaining.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data").update("more data");
   * const hash = hasher.digest();
   * ```
   */
  update(data: BytesLike): Hasher;
  /**
   * Finalizes the hash and returns the digest as a hexadecimal string.
   *
   * @returns The hexadecimal string representation of the hash.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data");
   * const hash = hasher.digest(); // Outputs something like "0x..."
   * ```
   */
  digest(): Hex;
}
//#endregion
//#region src/hasher/hasherCkb.d.ts
declare const HASH_CKB_LENGTH = 32;
declare const HASH_CKB_SHORT_LENGTH = 20;
/**
 * @public
 */
declare class HasherCkb implements Hasher {
  private readonly hasher;
  /**
   * Creates an instance of Hasher.
   *
   * @param outLength - The output length of the hash in bytes. Default is 32.
   * @param personal - The personal string for the Blake2b algorithm. Default is CKB_BLAKE2B_PERSONAL.
   */
  constructor(outLength?: number, personal?: Bytes$1);
  /**
   * Updates the hash with the given data.
   *
   * @param data - The data to update the hash with.
   * @returns The current Hasher instance for chaining.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data").update("more data");
   * const hash = hasher.digest();
   * ```
   */
  update(data: BytesLike): HasherCkb;
  /**
   * Finalizes the hash and returns the digest as a hexadecimal string.
   *
   * @returns The hexadecimal string representation of the hash.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data");
   * const hash = hasher.digest(); // Outputs something like "0x..."
   * ```
   */
  digest(): Hex;
}
/**
 * Computes the CKB hash of the given data using the Blake2b algorithm.
 * @public
 *
 * @param data - The data to hash.
 * @returns The hexadecimal string representation of the hash.
 *
 * @example
 * ```typescript
 * const hash = hashCkb("some data"); // Outputs something like "0x..."
 * ```
 */
declare function hashCkb(...data: BytesLike[]): Hex;
declare function hashCkbShort(...data: BytesLike[]): Hex;
//#endregion
//#region src/hasher/hasherKeecak256.d.ts
/**
 * @public
 */
declare class HasherKeecak256 implements Hasher {
  private readonly hasher;
  /**
   * Creates an instance of Hasher.
   */
  constructor();
  /**
   * Updates the hash with the given data.
   *
   * @param data - The data to update the hash with.
   * @returns The current Hasher instance for chaining.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data").update("more data");
   * const hash = hasher.digest();
   * ```
   */
  update(data: BytesLike): HasherKeecak256;
  /**
   * Finalizes the hash and returns the digest as a hexadecimal string.
   *
   * @returns The hexadecimal string representation of the hash.
   *
   * @example
   * ```typescript
   * const hasher = new Hasher();
   * hasher.update("some data");
   * const hash = hasher.digest(); // Outputs something like "0x..."
   * ```
   */
  digest(): Hex;
}
//#endregion
//#region src/jsonRpc/transports/transport.d.ts
type JsonRpcPayload = {
  id: number;
  jsonrpc: "2.0";
  method: string;
  params: unknown[] | Record<string, unknown>;
};
interface Transport {
  /**
   * Sends a JSON-RPC request to the server.
   *
   * @param payload - The JSON-RPC payload to send.
   * @returns The result of the JSON-RPC request.
   *
   * @throws Will throw an error if the response ID does not match the request ID, or if the response contains an error.
   */
  request(data: JsonRpcPayload): Promise<unknown>;
}
//#endregion
//#region src/jsonRpc/transports/http.d.ts
declare class TransportHttp implements Transport {
  private readonly url;
  private readonly timeout;
  constructor(url: string, timeout?: number);
  request(payload: JsonRpcPayload): Promise<any>;
}
//#endregion
//#region src/jsonRpc/transports/webSocket.d.ts
declare class TransportWebSocket implements Transport {
  private readonly url;
  private readonly timeout;
  private ongoing;
  private socket?;
  private openSocket?;
  constructor(url: string, timeout?: number);
  request(data: JsonRpcPayload): Promise<unknown>;
}
//#endregion
//#region src/jsonRpc/transports/factory.d.ts
declare function transportFromUri(uri: string, config?: {
  timeout?: number;
}): TransportWebSocket | TransportHttp;
//#endregion
//#region src/jsonRpc/transports/fallback.d.ts
declare class TransportFallback implements Transport {
  private readonly transports;
  private i;
  constructor(transports: Transport[]);
  request(data: JsonRpcPayload): Promise<unknown>;
}
//#endregion
//#region src/jsonRpc/requestor.d.ts
type RequestorJsonRpcConfig = {
  fallbacks?: string[];
  timeout?: number;
  maxConcurrent?: number;
  transport?: Transport;
};
declare class RequestorJsonRpc {
  private readonly url_;
  private readonly onError?;
  readonly maxConcurrent?: number;
  private concurrent;
  private readonly pending;
  readonly transport: Transport;
  private id;
  /**
   * Creates an instance of ClientJsonRpc.
   *
   * @param url_ - The URL of the JSON-RPC server.
   * @param timeout - The timeout for requests in milliseconds
   */
  constructor(url_: string, config?: RequestorJsonRpcConfig, onError?: ((err: unknown) => Promise<void> | void) | undefined);
  /**
   * Returns the URL of the JSON-RPC server.
   *
   * @returns The URL of the JSON-RPC server.
   */
  get url(): string;
  /**
   * request a JSON-RPC method.
   *
   * @param rpcMethod - The JSON-RPC method.
   * @param params - Params for the method.
   * @param inTransformers - An array of input transformers.
   * @param outTransformer - An output transformer function.
   * @returns Method response.
   */
  request(rpcMethod: string, params: unknown[], inTransformers?: (((_: any) => unknown) | undefined)[], outTransformer?: (_: any) => unknown): Promise<unknown>;
  requestPayload(payload: JsonRpcPayload): Promise<unknown>;
  /**
   * Builds a JSON-RPC payload for the given method and parameters.
   *
   * @param method - The JSON-RPC method name.
   * @param req - The parameters for the JSON-RPC method.
   * @returns The JSON-RPC payload.
   */
  buildPayload(method: string, req: unknown[]): JsonRpcPayload;
}
//#endregion
//#region src/keystore/index.d.ts
/**
 * @public
 */
declare function keystoreEncrypt(privateKeyLike: BytesLike, chainCodeLike: BytesLike, password: string): Promise<{
  id: string;
  crypto: {
    ciphertext: string;
    cipherparams: {
      iv: string;
    };
    cipher: string;
    kdf: string;
    kdfparams: {
      n: number;
      r: number;
      p: number;
      dklen: number;
      salt: string;
    };
    mac: string;
  };
}>;
/**
 * @public
 */
declare function keystoreDecrypt(keystore: unknown, password: string): Promise<{
  privateKey: Bytes$1;
  chainCode: Bytes$1;
}>;
//#endregion
//#region src/molecule/codec.d.ts
/**
 * Vector with fixed size item codec
 * @param itemCodec fixed-size vector item codec
 */
declare function fixedItemVec<Encodable, Decoded>(itemCodec: CodecLike<Encodable, Decoded>): Codec<Array<Encodable>, Array<Decoded>>;
/**
 * Vector with dynamic size item codec, you can create a recursive vector with this function
 * @param itemCodec the vector item codec. It can be fixed-size or dynamic-size.
 */
declare function dynItemVec<Encodable, Decoded>(itemCodec: CodecLike<Encodable, Decoded>): Codec<Array<Encodable>, Array<Decoded>>;
/**
 * General vector codec, if `itemCodec` is fixed size type, it will create a fixvec codec, otherwise a dynvec codec will be created.
 * @param itemCodec
 */
declare function vector<Encodable, Decoded>(itemCodec: CodecLike<Encodable, Decoded>): Codec<Array<Encodable>, Array<Decoded>>;
/**
 * Option is a dynamic-size type.
 * Serializing an option depends on whether it is empty or not:
 * - if it's empty, there is zero bytes (the size is 0).
 * - if it's not empty, just serialize the inner item (the size is same as the inner item's size).
 * @param innerCodec
 */
declare function option<Encodable, Decoded>(innerCodec: CodecLike<Encodable, Decoded>): Codec<Encodable | undefined | null, Decoded | undefined>;
/**
 * Wrap the encoded value with a fixed-length buffer
 * @param codec
 */
declare function byteVec<Encodable, Decoded>(codec: CodecLike<Encodable, Decoded>): Codec<Encodable, Decoded>;
type EncodableRecordOptionalKeys<T extends Record<string, CodecLike<any, any>>> = { [K in keyof T]: Extract<EncodableType<T[K]>, undefined> extends never ? never : K }[keyof T];
type EncodableRecord<T extends Record<string, CodecLike<any, any>>> = { [key in keyof Pick<T, EncodableRecordOptionalKeys<T>>]+?: EncodableType<T[key]> } & { [key in keyof Omit<T, EncodableRecordOptionalKeys<T>>]: EncodableType<T[key]> };
type DecodedRecordOptionalKeys<T extends Record<string, CodecLike<any, any>>> = { [K in keyof T]: Extract<DecodedType<T[K]>, undefined> extends never ? never : K }[keyof T];
type DecodedRecord<T extends Record<string, CodecLike<any, any>>> = { [key in keyof Pick<T, DecodedRecordOptionalKeys<T>>]+?: DecodedType<T[key]> } & { [key in keyof Omit<T, DecodedRecordOptionalKeys<T>>]: DecodedType<T[key]> };
/**
 * Table is a dynamic-size type. It can be considered as a dynvec but the length is fixed.
 * @param codecLayout
 */
declare function table<T extends Record<string, CodecLike<any, any>>, Encodable extends EncodableRecord<T>, Decoded extends DecodedRecord<T>>(codecLayout: T): Codec<Encodable, Decoded>;
type UnionEncodable<T extends Record<string, CodecLike<any, any>>, K extends keyof T = keyof T> = K extends unknown ? {
  type: K;
  value: EncodableType<T[K]>;
} : never;
type UnionDecoded<T extends Record<string, CodecLike<any, any>>, K extends keyof T = keyof T> = K extends unknown ? {
  type: K;
  value: DecodedType<T[K]>;
} : never;
/**
 * Constructs a union codec that can serialize and deserialize values tagged with a type identifier.
 *
 * If all variants have the same fixed size, the resulting union codec is fixed-size (header + payload).
 * Otherwise, it falls back to a dynamic-size codec.
 *
 * Serialization format:
 * 1. 4-byte little-endian unsigned integer for the variant index.
 * 2. Encoded bytes of the selected variant.
 *
 * @typeParam T
 *   A record mapping variant names to codecs.
 * @param codecLayout
 *   An object whose keys are variant names and values are codecs for each variant.
 * @param fields
 *   Optional mapping from variant names to custom numeric IDs. If omitted, the index
 *   of each variant in `codecLayout` is used as its ID.
 *
 *
 * @example
 * // Dynamic union without custom numeric IDs
 * union({ cafe: Uint8, bee: Uint16 })
 *
 * // Dynamic union with custom numeric IDs
 * union({ cafe: Uint8, bee: Uint16 }, { cafe: 0xcafe, bee: 0xbee })
 *
 * // Fixed-size union without custom numeric IDs
 * const PaddedUint8 = struct({ data : u8, padding : u8 })
 * union({ cafe: PaddedUint8, bee: Uint16 });
 *
 * // Fixed-size union with custom numeric IDs
 * union({ cafe: PaddedUint8, bee: Uint16 }, { cafe: 0xcafe, bee: 0xbee })
 */
declare function union<T extends Record<string, CodecLike<any, any>>>(codecLayout: T, fields?: Record<keyof T, number | undefined | null>): Codec<UnionEncodable<T>, UnionDecoded<T>>;
/**
 * Struct is a fixed-size type: all fields in struct are fixed-size and it has a fixed quantity of fields.
 * The size of a struct is the sum of all fields' size.
 * @param codecLayout a object contains all fields' codec
 */
declare function struct<T extends Record<string, CodecLike<any, any>>, Encodable extends EncodableRecord<T>, Decoded extends DecodedRecord<T>>(codecLayout: T): Codec<Encodable, Decoded>;
/**
 * The array is a fixed-size type: it has a fixed-size inner type and a fixed length.
 * The size of an array is the size of inner type times the length.
 * @param itemCodec the fixed-size array item codec
 * @param itemCount
 */
declare function array<Encodable, Decoded>(itemCodec: CodecLike<Encodable, Decoded>, itemCount: number): Codec<Array<Encodable>, Array<Decoded>>;
//#endregion
//#region src/molecule/predefined.d.ts
declare const Uint8Opt: Codec<NumLike | null | undefined, number | undefined>;
declare const Uint8Vec: Codec<NumLike[], number[]>;
declare const Uint16Opt: Codec<NumLike | null | undefined, number | undefined>;
declare const Uint16Vec: Codec<NumLike[], number[]>;
declare const Uint32Opt: Codec<NumLike | null | undefined, number | undefined>;
declare const Uint32Vec: Codec<NumLike[], number[]>;
declare const Uint64Opt: Codec<NumLike | null | undefined, bigint | undefined>;
declare const Uint64Vec: Codec<NumLike[], bigint[]>;
declare const Uint128Opt: Codec<NumLike | null | undefined, bigint | undefined>;
declare const Uint128Vec: Codec<NumLike[], bigint[]>;
declare const Uint256Opt: Codec<NumLike | null | undefined, bigint | undefined>;
declare const Uint256Vec: Codec<NumLike[], bigint[]>;
declare const Uint512Opt: Codec<NumLike | null | undefined, bigint | undefined>;
declare const Uint512Vec: Codec<NumLike[], bigint[]>;
declare const Bytes: Codec<HexLike, Hex>;
declare const BytesOpt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const BytesVec: Codec<BytesLike[], `0x${string}`[]>;
declare const BoolOpt: Codec<boolean | null | undefined, boolean | undefined>;
declare const BoolVec: Codec<boolean[], boolean[]>;
declare const ByteOpt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const ByteVec: Codec<BytesLike[], `0x${string}`[]>;
declare const Byte4Opt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const Byte4Vec: Codec<BytesLike[], `0x${string}`[]>;
declare const Byte8Opt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const Byte8Vec: Codec<BytesLike[], `0x${string}`[]>;
declare const Byte16Opt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const Byte16Vec: Codec<BytesLike[], `0x${string}`[]>;
declare const Byte32Opt: Codec<BytesLike | null | undefined, `0x${string}` | undefined>;
declare const Byte32Vec: Codec<BytesLike[], `0x${string}`[]>;
declare const String: Codec<string, string>;
declare const StringVec: Codec<string[], string[]>;
declare const StringOpt: Codec<string | null | undefined, string | undefined>;
declare namespace barrel_d_exports$1 {
  export { CodecBool as Bool, BoolOpt, BoolVec, CodecByte as Byte, CodecByte16 as Byte16, Byte16Opt, Byte16Vec, CodecByte32 as Byte32, Byte32Opt, Byte32Vec, CodecByte4 as Byte4, Byte4Opt, Byte4Vec, CodecByte8 as Byte8, Byte8Opt, Byte8Vec, ByteOpt, ByteVec, Bytes, BytesOpt, BytesVec, Codec, CodecLike, DecodedRecord, DecodedRecordOptionalKeys, DecodedType, EncodableRecord, EncodableRecordOptionalKeys, EncodableType, Entity, String, StringOpt, StringVec, CodecUint128 as Uint128, CodecUint128BE as Uint128BE, CodecUint128LE as Uint128LE, Uint128Opt, Uint128Vec, CodecUint16 as Uint16, CodecUint16BE as Uint16BE, CodecUint16LE as Uint16LE, Uint16Opt, Uint16Vec, CodecUint256 as Uint256, CodecUint256BE as Uint256BE, CodecUint256LE as Uint256LE, Uint256Opt, Uint256Vec, CodecUint32 as Uint32, CodecUint32BE as Uint32BE, CodecUint32LE as Uint32LE, Uint32Opt, Uint32Vec, CodecUint512 as Uint512, CodecUint512BE as Uint512BE, CodecUint512LE as Uint512LE, Uint512Opt, Uint512Vec, CodecUint64 as Uint64, CodecUint64BE as Uint64BE, CodecUint64LE as Uint64LE, Uint64Opt, Uint64Vec, CodecUint8 as Uint8, Uint8Opt, Uint8Vec, array, byteVec, codec, dynItemVec, fixedItemVec, option, struct, table, codecUint as uint, codecUintNumber as uintNumber, union, vector };
}
//#endregion
//#region src/signer/btc/psbt.d.ts
/**
 * Options for signing a PSBT (Partially Signed Bitcoin Transaction)
 */
type SignPsbtOptionsLike = {
  /**
   * Whether to finalize the PSBT after signing.
   * Default is true.
   */
  autoFinalized?: boolean;
  /**
   * Array of inputs to sign
   */
  inputsToSign?: InputToSignLike[];
};
declare class SignPsbtOptions {
  autoFinalized: boolean;
  inputsToSign: InputToSign[];
  constructor(autoFinalized: boolean, inputsToSign: InputToSign[]);
  static from(options?: SignPsbtOptionsLike): SignPsbtOptions;
}
/**
 * Specification for an input to sign in a PSBT.
 * Must specify at least one of: address or pubkey.
 */
type InputToSignLike = {
  /**
   * Which input to sign (index in the PSBT inputs array)
   */
  index: number;
  /**
   * (Optional) Sighash types to use for signing.
   */
  sighashTypes?: number[];
  /**
   * (Optional) When signing and unlocking Taproot addresses, the tweakSigner is used by default
   * for signature generation. Setting this to true allows for signing with the original private key.
   * Default value is false.
   */
  disableTweakSigner?: boolean;
} & ({
  /**
   * The address whose corresponding private key to use for signing.
   */
  address: string;
  /**
   * The public key whose corresponding private key to use for signing.
   */
  publicKey?: HexLike;
} | {
  /**
   * The address whose corresponding private key to use for signing.
   */
  address?: string;
  /**
   * The public key whose corresponding private key to use for signing.
   */
  publicKey: HexLike;
});
declare class InputToSign {
  index: number;
  sighashTypes?: number[] | undefined;
  disableTweakSigner?: boolean | undefined;
  address?: string | undefined;
  publicKey?: Hex | undefined;
  constructor(index: number, sighashTypes?: number[] | undefined, disableTweakSigner?: boolean | undefined, address?: string | undefined, publicKey?: Hex | undefined);
  static from(input: InputToSignLike): InputToSign;
}
//#endregion
//#region src/signer/signer/index.d.ts
/**
 * @public
 */
declare enum SignerSignType {
  Unknown = "Unknown",
  BtcEcdsa = "BtcEcdsa",
  EvmPersonal = "EvmPersonal",
  JoyId = "JoyId",
  NostrEvent = "NostrEvent",
  CkbSecp256k1 = "CkbSecp256k1",
  DogeEcdsa = "DogeEcdsa"
}
/**
 * An enumeration of signer display types in wallet.
 * @public
 */
declare enum SignerType {
  EVM = "EVM",
  BTC = "BTC",
  CKB = "CKB",
  Nostr = "Nostr",
  Doge = "Doge"
}
/**
 * @public
 */
type NetworkPreference = {
  addressPrefix: string;
  signerType: SignerType;
  /**
   * Wallet signers should check if the wallet is using preferred networks.
   * If not, try to switch to the first preferred network.
   * If non preferred, let users choose what they want.
   * BTC: // They made a mess...
   *   btc
   *   btcTestnet
   *   btcTestnet4 // UTXO Global
   *   btcSignet // OKX & UTXO Global
   *   fractalBtc // UniSat
   */
  network: string;
};
/**
 * @public
 */
declare class Signature {
  signature: string;
  identity: string;
  signType: SignerSignType;
  constructor(signature: string, identity: string, signType: SignerSignType);
}
/**
 * An abstract class representing a generic signer.
 * This class provides methods to connect, get addresses, and sign transactions.
 * @public
 */
declare abstract class Signer {
  protected client_: Client;
  constructor(client_: Client);
  abstract get type(): SignerType;
  abstract get signType(): SignerSignType;
  get client(): Client;
  matchNetworkPreference(preferences: NetworkPreference[], currentNetwork: string | undefined): NetworkPreference | undefined;
  static verifyMessage(message: string | BytesLike, signature: Signature): Promise<boolean>;
  /**
   * Connects to the signer.
   *
   * @returns A promise that resolves when the connection is complete.
   */
  abstract connect(): Promise<void>;
  /**
   * Register a listener to be called when this signer is replaced.
   *
   * @returns A function for unregister
   */
  onReplaced(_: () => void): () => void;
  /**
   * Disconnects to the signer.
   *
   * @returns A promise that resolves when the signer is disconnected.
   */
  disconnect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  abstract isConnected(): Promise<boolean>;
  /**
   * Gets the internal address associated with the signer.
   *
   * @returns A promise that resolves to a string representing the internal address.
   */
  abstract getInternalAddress(): Promise<string>;
  /**
   * Gets the identity for verifying signature, usually it's address
   *
   * @returns A promise that resolves to a string representing the identity
   */
  getIdentity(): Promise<string>;
  /**
   * Gets an array of Address objects associated with the signer.
   *
   * @returns A promise that resolves to an array of Address objects.
   */
  abstract getAddressObjs(): Promise<Address[]>;
  /**
   * Gets the recommended Address object for the signer.
   *
   * @param _preference - Optional preference parameter.
   * @returns A promise that resolves to the recommended Address object.
   */
  getRecommendedAddressObj(_preference?: unknown): Promise<Address>;
  /**
   * Gets the recommended address for the signer as a string.
   *
   * @param preference - Optional preference parameter.
   * @returns A promise that resolves to the recommended address as a string.
   */
  getRecommendedAddress(preference?: unknown): Promise<string>;
  /**
   * Gets an array of addresses associated with the signer as strings.
   *
   * @returns A promise that resolves to an array of addresses as strings.
   */
  getAddresses(): Promise<string[]>;
  /**
   * Find cells of this signer
   *
   * @param filter - The filter for the search key.
   * @param withData - Whether to include cell data in the response.
   * @param order - The order of the returned cells, can be "asc" or "desc".
   * @param limit - The maximum number of cells for every querying chunk.
   * @returns A async generator that yields all matching cells
   */
  findCellsOnChain(filter: ClientIndexerSearchKeyFilterLike, withData?: boolean | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  /**
   * Find cells of this signer
   *
   * @returns A async generator that yields all matches cells
   */
  findCells(filter: ClientCollectableSearchKeyFilterLike, withData?: boolean | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  /**
   * Find transactions of this signer
   *
   * @returns A async generator that yields all matches transactions
   */
  findTransactions(filter: ClientCollectableSearchKeyFilterLike, groupByTransaction?: false | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0]>;
  /**
   * Find transactions of this signer
   *
   * @returns A async generator that yields all matches transactions
   */
  findTransactions(filter: ClientCollectableSearchKeyFilterLike, groupByTransaction: true, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsGroupedResponse["transactions"][0]>;
  /**
   * Find transactions of this signer
   *
   * @returns A async generator that yields all matches transactions
   */
  findTransactions(filter: ClientCollectableSearchKeyFilterLike, groupByTransaction?: boolean | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0] | ClientFindTransactionsGroupedResponse["transactions"][0]>;
  /**
   * Gets balance of all addresses
   *
   * @returns A promise that resolves to the balance
   */
  getBalance(): Promise<Num>;
  /**
   * Signs a message.
   *
   * @param message - The message to sign, as a string or BytesLike object.
   * @returns A promise that resolves to the signature info.
   * @throws Will throw an error if not implemented.
   */
  signMessage(message: string | BytesLike): Promise<Signature>;
  /**
   * Signs a message and returns signature only. This method is not implemented and should be overridden by subclasses.
   *
   * @param _ - The message to sign, as a string or BytesLike object.
   * @returns A promise that resolves to the signature as a string.
   * @throws Will throw an error if not implemented.
   */
  signMessageRaw(_: string | BytesLike): Promise<string>;
  /**
   * Verify a signature.
   *
   * @param message - The original message.
   * @param signature - The signature to verify.
   * @returns A promise that resolves to the verification result.
   * @throws Will throw an error if not implemented.
   */
  verifyMessage(message: string | BytesLike, signature: string | Signature): Promise<boolean>;
  /**
   * Sends a transaction after signing it.
   *
   * @param tx - The transaction to send, represented as a TransactionLike object.
   * @returns A promise that resolves to the transaction hash as a Hex string.
   */
  sendTransaction(tx: TransactionLike): Promise<Hex>;
  /**
   * Signs a transaction.
   *
   * @param tx - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to the signed Transaction object.
   */
  signTransaction(tx: TransactionLike): Promise<Transaction>;
  /**
   * Prepares a transaction before signing.
   * This method can be overridden by subclasses to perform any necessary steps,
   * such as adding cell dependencies or witnesses, before the transaction is signed.
   * The default implementation converts the {@link TransactionLike} object to a {@link Transaction} object
   * without modification.
   *
   * @remarks
   * Note that this default implementation does not add any cell dependencies or dummy witnesses.
   * This may lead to an underestimation of transaction size and fees if used with methods
   * like `Transaction.completeFee`. Subclasses for signers that are intended to sign
   * transactions should override this method to perform necessary preparations.
   *
   * @param tx - The transaction to prepare.
   * @returns A promise that resolves to the prepared {@link Transaction} object.
   */
  prepareTransaction(tx: TransactionLike): Promise<Transaction>;
  /**
   * Signs a transaction without preparing information for it. This method is not implemented and should be overridden by subclasses.
   *
   * @param _ - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to the signed Transaction object.
   * @throws Will throw an error if not implemented.
   */
  signOnlyTransaction(_: TransactionLike): Promise<Transaction>;
}
/**
 * An abstract class representing a multisig signer.
 * @public
 */
declare abstract class SignerMultisig extends Signer {
  /**
   * Get the number of members in the multisig script.
   * @returns The number of members.
   */
  abstract getMemberCount(): Promise<number>;
  /**
   * Get the threshold of the multisig script.
   * @returns The threshold.
   */
  abstract getMemberThreshold(): Promise<number>;
  /**
   * Get the count of required member of the multisig script.
   * @returns The must match count.
   */
  abstract getMemberRequiredCount(): Promise<number>;
  /**
   * Get the number of valid signatures for matching multisig inputs in the transaction.
   *
   * @remarks
   * Returns `undefined` when the transaction has no inputs locked by any multisig address
   * supported by this signer. This method only evaluates matching multisig inputs and does
   * not indicate whether the transaction itself is expected to be signed by this multisig.
   *
   * @param _ - The transaction.
   * @returns The matched multisig signature count, or `undefined` when the transaction is unrelated to any multisig address supported by this signer.
   */
  abstract getSignaturesCount(_: TransactionLike): Promise<number | undefined>;
  /**
   * Check if related multisig inputs in the transaction need more signatures.
   *
   * @remarks
   * Returns `false` when the transaction has no inputs locked by any multisig address
   * supported by this signer.
   * A `false` result therefore means either the related multisig inputs are already fulfilled,
   * or the transaction is unrelated to all multisig addresses supported by this signer.
   *
   * @param txLike - The transaction to check.
   * @returns A promise that resolves to `true` when related multisig inputs still need signatures, and `false` otherwise.
   */
  abstract needMoreSignatures(_: TransactionLike): Promise<boolean>;
  /**
   * Aggregate transactions.
   * @param _ - The transactions to aggregate.
   * @returns The aggregated transaction.
   */
  abstract aggregateTransactions(_: TransactionLike[]): Promise<Transaction>;
  /**
   * Send a transaction.
   *
   * @remarks
   * This method rejects the transaction only when related multisig inputs still need signatures.
   * It does not verify that the transaction actually contains inputs locked by any multisig
   * address supported by this signer, so transactions unrelated to those multisig addresses
   * are not rejected by this check.
   *
   * @param tx - The transaction to send.
   * @returns The transaction hash.
   */
  sendTransaction(tx: TransactionLike): Promise<Hex>;
}
/**
 * Thrown when a multisig transaction is sent before enough signatures are collected.
 *
 * @public
 */
declare class SignerMultisigNotEnoughSignaturesError extends Error {
  readonly signaturesCount: number;
  readonly threshold: number;
  constructor(signaturesCount: number, threshold: number);
}
/**
 * A class representing information about a signer, including its type and the signer instance.
 * @public
 */
declare class SignerInfo {
  name: string;
  signer: Signer;
  constructor(name: string, signer: Signer);
}
/**
 * Represents a wallet with a name, icon, and an array of signer information.
 * @public
 */
type Wallet = {
  name: string;
  icon: string;
};
//#endregion
//#region src/signer/btc/signerBtc.d.ts
/**
 * An abstract class extending the Signer class for Bitcoin-like signing operations.
 * This class provides methods to get Bitcoin account, public key, and internal address,
 * as well as signing transactions.
 * @public
 */
declare abstract class SignerBtc extends Signer {
  get type(): SignerType;
  get signType(): SignerSignType;
  /**
   * Sign and broadcast a PSBT.
   *
   * @param psbtHex - The hex string of PSBT to sign and broadcast.
   * @param options - Options for signing the PSBT.
   * @returns A promise that resolves to the transaction ID as a Hex string.
   */
  signAndBroadcastPsbt(psbtHex: HexLike, options?: SignPsbtOptionsLike): Promise<Hex>;
  /**
   * Gets the Bitcoin account associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Bitcoin account.
   */
  abstract getBtcAccount(): Promise<string>;
  /**
   * Gets the Bitcoin public key associated with the signer.
   *
   * @returns A promise that resolves to a HexLike value representing the Bitcoin public key.
   */
  abstract getBtcPublicKey(): Promise<HexLike>;
  /**
   * Gets the internal address, which is the Bitcoin account in this case.
   *
   * @returns A promise that resolves to a string representing the internal address.
   */
  getInternalAddress(): Promise<string>;
  /**
   * Gets the identity, which is the Bitcoin public key in this case.
   *
   * @returns A promise that resolves to a string representing the identity
   */
  getIdentity(): Promise<string>;
  /**
   * Gets an array of Address objects representing the known script addresses for the signer.
   *
   * @returns A promise that resolves to an array of Address objects.
   */
  getAddressObjs(): Promise<Address[]>;
  /**
   * prepare a transaction before signing. This method is not implemented and should be overridden by subclasses.
   *
   * @param txLike - The transaction to prepare, represented as a TransactionLike object.
   * @returns A promise that resolves to the prepared Transaction object.
   */
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Signs a transaction without modifying it.
   *
   * @param txLike - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to a signed Transaction object.
   */
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Signs a Partially Signed Bitcoin Transaction (PSBT).
   *
   * @param psbtHex - The hex string of PSBT to sign.
   * @param options - Options for signing the PSBT
   * @returns A promise that resolves to the signed PSBT as a Hex string.
   */
  abstract signPsbt(psbtHex: HexLike, options?: SignPsbtOptionsLike): Promise<Hex>;
  /**
   * Broadcasts a PSBT to the Bitcoin network.
   *
   * @param psbtHex - The hex string of the PSBT to broadcast.
   * @param options - Options for broadcasting the PSBT.
   * @returns A promise that resolves to the transaction ID as a Hex string.
   */
  abstract broadcastPsbt(psbtHex: HexLike, options?: SignPsbtOptionsLike): Promise<Hex>;
}
//#endregion
//#region src/signer/btc/signerBtcPublicKeyReadonly.d.ts
/**
 * A class extending SignerBtc that provides read-only access to a Bitcoin public key and account.
 * This class does not support signing operations.
 * @public
 */
declare class SignerBtcPublicKeyReadonly extends SignerBtc {
  private readonly account;
  private readonly publicKey;
  /**
   * Creates an instance of SignerBtcPublicKeyReadonly.
   *
   * @param client - The client instance used for communication.
   * @param account - The Bitcoin account associated with the signer.
   * @param publicKey - The public key associated with the signer.
   */
  constructor(client: Client, account: string, publicKey: HexLike);
  /**
   * Connects to the client. This implementation does nothing as the class is read-only.
   *
   * @returns A promise that resolves when the connection is complete.
   */
  connect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  isConnected(): Promise<boolean>;
  /**
   * Gets the Bitcoin account associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Bitcoin account.
   *
   * @example
   * ```typescript
   * const account = await signer.getBtcAccount(); // Outputs the Bitcoin account
   * ```
   */
  getBtcAccount(): Promise<string>;
  /**
   * Gets the Bitcoin public key associated with the signer.
   *
   * @returns A promise that resolves to a Hex string representing the Bitcoin public key.
   *
   * @example
   * ```typescript
   * const publicKey = await signer.getBtcPublicKey(); // Outputs the Bitcoin public key
   * ```
   */
  getBtcPublicKey(): Promise<Hex>;
  signPsbt(_psbtHex: HexLike, _options?: SignPsbtOptionsLike): Promise<Hex>;
  broadcastPsbt(_psbtHex: HexLike, _options?: SignPsbtOptionsLike): Promise<Hex>;
}
//#endregion
//#region src/signer/btc/verify.d.ts
/**
 * Encodes a number into a variable-length byte array according to the Bitcoin protocol.
 * This format is used for encoding lengths of data, such as script lengths.
 *
 * @param len - The number to encode. Can be a NumLike.
 * @returns The encoded length as a Bytes.
 * @public
 */
declare function btcVarLengthBytesFrom(len: NumLike): Bytes$1;
/**
 * Computes the message hash for Bitcoin ECDSA signatures.
 * This function follows the Bitcoin message signing standard, which involves
 * prefixing the message with a magic string and its length, then double SHA256 hashing the result.
 *
 * @param message - The message to be hashed. Can be a string or BytesLike.
 * @param messagePrefix - Optional. A custom prefix to use instead of the default "\u0018Bitcoin Signed Message:\n".
 * @returns The Bitcoin hash of the prefixed message as Bytes.
 * @public
 */
declare function messageHashBtcEcdsa(message: string | BytesLike, messagePrefix?: string | BytesLike): Bytes$1;
/**
 * @public
 */
declare function btcEcdsaPublicKeyHash(publicKey: BytesLike): Bytes$1;
/**
 * @public
 */
declare function btcP2pkhAddressFromPublicKey(publicKey: BytesLike, network: number): string;
/**
 * @public
 */
declare function btcPublicKeyFromP2pkhAddress(address: string): Hex;
/**
 * @public
 */
declare function verifyMessageBtcEcdsa(message: string | BytesLike, signature: string, publicKey: string): boolean;
//#endregion
//#region src/signer/ckb/secp256k1Signing.d.ts
declare const SECP256K1_SIGNATURE_LENGTH = 65;
/**
 * Sign a message using Secp256k1.
 *
 * @param message - The message to sign.
 * @param privateKey - The private key.
 * @returns The signature.
 * @public
 */
declare function signMessageSecp256k1(message: BytesLike, privateKey: BytesLike): Hex;
/**
 * Verify a message using Secp256k1.
 *
 * @param message - The message to verify.
 * @param signature - The signature.
 * @param publicKey - The public key.
 * @returns True if the signature is valid, false otherwise.
 * @public
 */
declare function verifyMessageSecp256k1(message: BytesLike, signature: BytesLike, publicKey: BytesLike): boolean;
/**
 * Recover the public key from a Secp256k1 signature.
 *
 * @param message - The message.
 * @param signature - The signature.
 * @returns The recovered public key.
 * @public
 */
declare function recoverMessageSecp256k1(message: BytesLike, signature: BytesLike): Hex;
/**
 * @public
 */
declare function messageHashCkbSecp256k1(message: string | BytesLike): Hex;
/**
 * @public
 */
declare function verifyMessageCkbSecp256k1(message: string | BytesLike, signature: string, publicKey: string): boolean;
//#endregion
//#region src/signer/ckb/signerCkbPublicKey.d.ts
/**
 * @public
 */
declare class SignerCkbPublicKey extends Signer {
  get type(): SignerType;
  get signType(): SignerSignType;
  readonly publicKey: Hex;
  constructor(client: Client, publicKey: HexLike);
  connect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getInternalAddress(): Promise<string>;
  getIdentity(): Promise<string>;
  getAddressObjSecp256k1(): Promise<Address>;
  getRecommendedAddressObj(_preference?: unknown): Promise<Address>;
  getAddressObjs(): Promise<Address[]>;
  getRelatedScripts(txLike: TransactionLike): Promise<{
    script: Script;
    cellDeps: CellDepInfo[];
  }[]>;
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
}
//#endregion
//#region src/signer/ckb/signerCkbPrivateKey.d.ts
/**
 * @public
 */
declare class SignerCkbPrivateKey extends SignerCkbPublicKey {
  readonly privateKey: Hex;
  constructor(client: Client, privateKey: HexLike);
  _signMessage(message: HexLike): Promise<Hex>;
  signMessageRaw(message: string | BytesLike): Promise<Hex>;
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
}
//#endregion
//#region src/signer/ckb/signerCkbScriptReadonly.d.ts
/**
 * A read-only signer for a CKB script. It can be used to get addresses,
 * but not to sign transactions. This is useful when you want to watch an address
 * without having the private key.
 *
 * @public
 */
declare class SignerCkbScriptReadonly extends Signer {
  /**
   * The type of the signer.
   */
  get type(): SignerType;
  /**
   * The sign type of the signer.
   * As this is a read-only signer, the sign type is {@link SignerSignType.Unknown}.
   */
  get signType(): SignerSignType;
  /**
   * The scripts associated with the signer.
   */
  readonly scripts: Script[];
  /**
   * Creates an instance of SignerCkbScriptReadonly.
   *
   * @param client - The client instance used for communication.
   * @param scripts - The scripts associated with the signer. Can be a single script, an array of scripts, or multiple script arguments.
   */
  constructor(client: Client, ...scripts: (ScriptLike | ScriptLike[])[]);
  /**
   * Connects to the client. This implementation does nothing as the class is read-only.
   *
   * @returns A promise that resolves when the connection is complete.
   */
  connect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  isConnected(): Promise<boolean>;
  /**
   * Gets the internal address for the script.
   *
   * @returns A promise that resolves to a string representing the internal address.
   *
   * @example
   * ```typescript
   * const internalAddress = await signer.getInternalAddress(); // Outputs the internal address
   * ```
   */
  getInternalAddress(): Promise<string>;
  /**
   * Gets an array of Address objects representing the script address.
   *
   * @returns A promise that resolves to an array of Address objects.
   *
   * @example
   * ```typescript
   * const addressObjs = await signer.getAddressObjs(); // Outputs the array of Address objects
   * ```
   */
  getAddressObjs(): Promise<Address[]>;
}
//#endregion
//#region src/signer/ckb/signerMultisigCkbReadonly.d.ts
type MultisigCkbWitnessLike = ({
  publicKeyHashes: HexLike[];
  publicKeys?: undefined | null;
} | {
  publicKeyHashes?: undefined | null;
  publicKeys: HexLike[];
}) & {
  threshold: NumLike;
  mustMatch?: NumLike | null;
  signatures?: HexLike[] | null;
};
declare const MultisigCkbWitness_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): MultisigCkbWitness;
  eq(other: MultisigCkbWitnessLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: MultisigCkbWitnessLike): Bytes$1;
  decode(_: BytesLike): MultisigCkbWitness;
  fromBytes(_bytes: BytesLike): MultisigCkbWitness;
  from(_: MultisigCkbWitnessLike): MultisigCkbWitness;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * A class representing multisig information, holding information ingredients and containing utilities.
 * @public
 */
declare class MultisigCkbWitness extends MultisigCkbWitness_base {
  publicKeyHashes: Hex[];
  threshold: number;
  mustMatch: number;
  signatures: Hex[];
  /**
   * @param publicKeyHashes - The public key hashes.
   * @param threshold - The threshold.
   * @param mustMatch - The number of signatures that must match.
   * @param signatures - The signatures.
   */
  constructor(publicKeyHashes: Hex[], threshold: number, mustMatch: number, signatures: Hex[]);
  /**
   * Create a MultisigCkbWitness from a MultisigCkbWitnessLike.
   *
   * @param witness - The witness like object.
   * @returns The MultisigCkbWitness.
   */
  static from(witness: MultisigCkbWitnessLike): MultisigCkbWitness;
  /**
   * Get the threshold of flexible signatures.
   */
  get flexibleThreshold(): number;
  /**
   * Get the script args of the multisig script.
   *
   * @param since - The since value.
   * @returns The script args.
   */
  scriptArgs(since?: SinceLike | null): Bytes$1;
  /**
   * Check if the multisig info is equal to another.
   *
   * @param otherLike - The other multisig info.
   * @returns True if the multisig info is equal, false otherwise.
   */
  eqInfo(otherLike: MultisigCkbWitnessLike): boolean;
  /**
   * Generate valid public key hashes and their signatures from the witness.
   * This method filters out invalid signatures, duplicate signatures, and signatures not in the multisig script.
   *
   * @param message - The message signed.
   * @returns A generator of public key hashes, signatures, and whether the signature is required.
   */
  generatePublicKeyHashesFromSignatures(message: BytesLike): Generator<{
    pubkeyHash: Hex;
    signature: Hex;
    isRequired: boolean;
  }>;
  /**
   * Calculate the number of matched signatures in the witness.
   *
   * @param message - The message signed.
   * @returns The number of required and flexible signatures.
   */
  calcMatchedSignaturesCount(message: BytesLike): {
    required: number;
    flexible: number;
  };
}
/**
 * A class extending Signer that provides access to a CKB multisig script.
 * This class does not support signing operations.
 * @public
 */
declare class SignerMultisigCkbReadonly extends SignerMultisig {
  static EmptySignature: `0x${string}`;
  get type(): SignerType;
  get signType(): SignerSignType;
  readonly multisigInfo: MultisigCkbWitness;
  readonly since?: Since;
  readonly scriptInfos: Promise<{
    script: Script;
    cellDeps: CellDepInfo[];
  }[]>;
  /**
   * Creates an instance of SignerMultisigCkbReadonly.
   *
   * @param client - The client instance.
   * @param multisigInfoLike - The multisig information.
   * @param options - The options.
   */
  constructor(client: Client, multisigInfoLike: MultisigCkbWitnessLike, options?: {
    since?: SinceLike | null;
    scriptInfos?: (KnownScript | ScriptInfoLike)[] | null;
  } | null);
  /**
   * Get the number of members in the multisig script.
   *
   * @returns The number of members.
   */
  getMemberCount(): Promise<number>;
  /**
   * Get the threshold of the multisig script.
   *
   * @returns The threshold.
   */
  getMemberThreshold(): Promise<number>;
  /**
   * Get the count of required member of the multisig script.
   *
   * @returns The must match count.
   */
  getMemberRequiredCount(): Promise<number>;
  connect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getInternalAddress(): Promise<string>;
  getAddressObjs(): Promise<Address[]>;
  /**
   * Decode the witness args at a specific index.
   *
   * @param txLike - The transaction.
   * @param index - The index of the witness args.
   * @returns The decoded MultisigCkbWitness.
   */
  decodeWitnessArgsAt(txLike: TransactionLike, index: number): MultisigCkbWitness | undefined;
  /**
   * Decode the witness args.
   *
   * @param witnessLike - The witness args like object.
   * @returns The decoded MultisigCkbWitness.
   */
  decodeWitnessArgs(witnessLike?: WitnessArgsLike | null): MultisigCkbWitness | undefined;
  /**
   * Prepare the witness args at a specific index.
   *
   * @param txLike - The transaction.
   * @param index - The index of the witness args.
   * @param transformer - The transformer function.
   * @returns The prepared transaction.
   */
  prepareWitnessArgsAt(txLike: TransactionLike, index: number, transformer?: ((witness: MultisigCkbWitness, witnessArgs: WitnessArgs) => MultisigCkbWitnessLike | undefined | null | void | Promise<MultisigCkbWitnessLike | undefined | null | void>) | null): Promise<Transaction>;
  /**
   * Prepare multisig witness, if the existence of multisig witness is detected, nothing happens
   *
   * @param txLike - The transaction to prepare.
   * @param scriptLike - The script to prepare.
   * @returns A promise that resolves to the prepared transaction
   */
  prepareTransactionOneScript(txLike: TransactionLike, script: ScriptLike, cellDeps: CellDepInfoLike[]): Promise<Transaction>;
  /**
   * Prepare transaction for multisig witness and adding related cell deps
   *
   * @param txLike - The transaction to prepare.
   * @returns A promise that resolves to the prepared transaction
   */
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Get the number of valid signatures for matching multisig inputs in the transaction.
   *
   * @remarks
   * Returns `undefined` when the transaction has no inputs locked by any multisig address
   * supported by this signer. This method only counts signatures for matching multisig inputs
   * and does not imply that the transaction should be signed by this multisig.
   *
   * @param txLike - The transaction.
   * @returns The matched multisig signature count, or `undefined` when the transaction is unrelated to any multisig address supported by this signer.
   */
  getSignaturesCount(txLike: TransactionLike): Promise<number | undefined>;
  /**
   * Check if related multisig inputs in the transaction need more signatures.
   *
   * @remarks
   * Returns `false` when the transaction has no inputs locked by any multisig address
   * supported by this signer.
   * A `false` result therefore means either the related multisig inputs are already fulfilled,
   * or the transaction is unrelated to all multisig addresses supported by this signer.
   *
   * @param txLike - The transaction to check.
   * @returns A promise that resolves to `true` when related multisig inputs still need signatures, and `false` otherwise.
   */
  needMoreSignatures(txLike: TransactionLike): Promise<boolean>;
  /**
   * Get the sign info for a script.
   *
   * @param txLike - The transaction.
   * @param script - The script.
   * @returns The sign info.
   */
  getSignInfo(txLike: TransactionLike, script: ScriptLike): Promise<{
    message: Hex;
    position: number;
  } | undefined>;
  /**
   * Aggregate transactions.
   *
   * @param txs - The transactions to aggregate.
   * @returns The aggregated transaction.
   */
  aggregateTransactions(txs: TransactionLike[]): Promise<Transaction>;
}
//#endregion
//#region src/signer/ckb/signerMultisigCkbPrivateKey.d.ts
/**
 * A class extending Signer that provides access to a CKB multisig script and supports signing operations.
 * @public
 */
declare class SignerMultisigCkbPrivateKey extends SignerMultisigCkbReadonly {
  private readonly privateKey;
  private readonly signer;
  /**
   * Creates an instance of SignerMultisigCkbPrivateKey.
   *
   * @param client - The client instance.
   * @param privateKey - The private key.
   * @param multisigInfo - The multisig information.
   * @param options - The options.
   */
  constructor(client: Client, privateKey: HexLike, multisigInfo: MultisigCkbWitnessLike, options?: {
    since?: SinceLike | null;
    scriptInfos?: (KnownScript | ScriptInfoLike)[] | null;
  } | null);
  /**
   * Sign a transaction only (without preparing).
   *
   * @param txLike - The transaction to sign.
   * @returns The signed transaction.
   */
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
}
//#endregion
//#region src/signer/ckb/verifyJoyId.d.ts
/**
 * @public
 */
declare function verifyMessageJoyId(message: string | BytesLike, signature: string, identity: string): Promise<boolean>;
//#endregion
//#region src/signer/doge/signerDoge.d.ts
/**
 * An abstract class extending the Signer class for Dogecoin-like signing operations.
 * This class provides methods to get Doge account, public key, and internal address,
 * as well as signing transactions.
 * @public
 */
declare abstract class SignerDoge extends Signer {
  get type(): SignerType;
  get signType(): SignerSignType;
  /**
   * Gets the Doge address associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Doge account.
   */
  abstract getDogeAddress(): Promise<string>;
  /**
   * Gets the internal address, which is the Doge account in this case.
   *
   * @returns A promise that resolves to a string representing the internal address.
   */
  getInternalAddress(): Promise<string>;
  /**
   * Gets the identity, which is the Doge address in this case.
   *
   * @returns A promise that resolves to a string representing the identity
   */
  getIdentity(): Promise<string>;
  /**
   * Gets an array of Address objects representing the known script addresses for the signer.
   *
   * @returns A promise that resolves to an array of Address objects.
   */
  getAddressObjs(): Promise<Address[]>;
  /**
   * prepare a transaction before signing. This method is not implemented and should be overridden by subclasses.
   *
   * @param txLike - The transaction to prepare, represented as a TransactionLike object.
   * @returns A promise that resolves to the prepared Transaction object.
   */
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Signs a transaction without modifying it.
   *
   * @param txLike - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to a signed Transaction object.
   */
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
}
//#endregion
//#region src/signer/doge/signerDogeAddressReadonly.d.ts
/**
 * A class extending SignerDoge that provides read-only access to a Doge address.
 * This class does not support signing operations.
 * @public
 */
declare class SignerDogeAddressReadonly extends SignerDoge {
  private readonly address;
  /**
   * Creates an instance of SignerDogeAddressReadonly.
   *
   * @param client - The client instance used for communication.
   * @param address - The Doge address with the signer.
   */
  constructor(client: Client, address: string);
  /**
   * Connects to the client. This implementation does nothing as the class is read-only.
   *
   * @returns A promise that resolves when the connection is complete.
   */
  connect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  isConnected(): Promise<boolean>;
  /**
   * Gets the Doge address associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Doge address.
   *
   * @example
   * ```typescript
   * const account = await signer.getDogeAddress(); // Outputs the Doge address
   * ```
   */
  getDogeAddress(): Promise<string>;
}
//#endregion
//#region src/signer/doge/signerDogePrivateKey.d.ts
/**
 * A class extending SignerDoge that provides access to a Doge address.
 * @public
 */
declare class SignerDogePrivateKey extends SignerDoge {
  readonly dogeNetwork: number;
  private readonly privateKey;
  /**
   * Creates an instance of SignerDogePrivateKey
   *
   * @param client - The client instance used for communication.
   * @param privateKey - The Doge private key with the signer.
   */
  constructor(client: Client, privateKey: BytesLike, dogeNetwork?: number);
  /**
   * Connects to the client. This implementation does nothing as the class is always connected.
   *
   * @returns A promise that resolves when the connection is complete.
   */
  connect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  isConnected(): Promise<boolean>;
  getDogePublicKey(): Promise<Hex>;
  /**
   * Gets the Doge address associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Doge address.
   *
   * @example
   * ```typescript
   * const account = await signer.getDogeAddress(); // Outputs the Doge address
   * ```
   */
  getDogeAddress(): Promise<string>;
  /**
   * Signs a message and returns signature only.
   *
   * @param msg - The message to sign, as a string or BytesLike object.
   * @returns A promise that resolves to the signature as a string.
   * @throws Will throw an error if not implemented.
   */
  signMessageRaw(msg: string | BytesLike): Promise<string>;
}
//#endregion
//#region src/signer/doge/verify.d.ts
/**
 * Computes the message hash for Dogecoin ECDSA signatures.
 * This function follows the Dogecoin message signing standard, which involves
 * prefixing the message with a magic string and its length, then double SHA256 hashing the result.
 *
 * @param message - The message to be hashed. Can be a string or BytesLike.
 * @param messagePrefix - Optional. A custom prefix to use instead of the default "\x19Dogecoin Signed Message:\n".
 * @returns The Dogecoin hash of the prefixed message as Bytes.
 * @public
 */
declare function messageHashDogeEcdsa(message: string | BytesLike, messagePrefix?: string | BytesLike): Bytes$1;
/**
 * @public
 */
declare function verifyMessageDogeEcdsa(message: string | BytesLike, signature: string, address: string): boolean;
//#endregion
//#region src/signer/dummy/dummy.d.ts
/**
 * @public
 */
declare abstract class SignerDummy extends Signer {
  readonly type: SignerType;
  get signType(): SignerSignType;
  constructor(client: Client, type: SignerType);
  isConnected(): Promise<boolean>;
  getInternalAddress(): Promise<string>;
  getAddressObjs(): Promise<Address[]>;
}
//#endregion
//#region src/signer/dummy/alwaysError.d.ts
/**
 * @public
 */
declare class SignerAlwaysError extends SignerDummy {
  private readonly message;
  constructor(client: Client, type: SignerType, message: string);
  connect(): Promise<void>;
}
//#endregion
//#region src/signer/dummy/openLink.d.ts
/**
 * @public
 */
declare class SignerOpenLink extends SignerDummy {
  private readonly link;
  constructor(client: Client, type: SignerType, link: string);
  connect(): Promise<void>;
}
//#endregion
//#region src/signer/evm/signerEvm.d.ts
/**
 * An abstract class extending Signer for Ethereum Virtual Machine (EVM) based signing operations.
 * This class provides methods to get EVM account, internal address, and signing transactions.
 * @public
 */
declare abstract class SignerEvm extends Signer {
  get type(): SignerType;
  get signType(): SignerSignType;
  /**
   * Gets the EVM account associated with the signer.
   *
   * @returns A promise that resolves to a string representing the EVM account.
   */
  abstract getEvmAccount(): Promise<Hex>;
  /**
   * Gets the internal address, which is the EVM account in this case.
   *
   * @returns A promise that resolves to a string representing the internal address.
   */
  getInternalAddress(): Promise<string>;
  /**
   * Gets an array of Address objects representing the known script addresses for the signer.
   *
   * @returns A promise that resolves to an array of Address objects.
   */
  getAddressObjs(): Promise<Address[]>;
  _getOmniLockAddresses(account: HexLike): Promise<Address[]>;
  _getPWLockAddresses(account: HexLike): Promise<Address[]>;
  _getOmniLockEvmAddressObj(account: HexLike): Promise<Address>;
  _getOmniLockOldEvmAddressObj(account: HexLike): Promise<Address>;
  _getPWLockEvmAddressObj(account: HexLike): Promise<Address | undefined>;
  /**
   * prepare a transaction before signing. This method is not implemented and should be overridden by subclasses.
   *
   * @param txLike - The transaction to prepare, represented as a TransactionLike object.
   * @returns A promise that resolves to the prepared Transaction object.
   */
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Signs a transaction without modifying it.
   *
   * @param txLike - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to a signed Transaction object.
   */
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
  _signOmniLockScriptForTransaction(tx: Transaction, script: Script, messageTransformer: (hash: string) => BytesLike): Promise<Transaction>;
  _signPWLockScriptForTransaction(tx: Transaction, script: Script, messageTransformer: (hash: string) => BytesLike): Promise<Transaction>;
  _signPersonalEvmForTransaction(tx: Transaction, script: Script, messageTransformer: (hash: string) => BytesLike, hasher?: Hasher): Promise<{
    signature: Bytes$1;
    position: number;
  } | undefined>;
}
//#endregion
//#region src/signer/evm/signerEvmAddressReadonly.d.ts
/**
 * A class extending SignerEvm that provides read-only access to an EVM address.
 * This class does not support signing operations.
 * @public
 */
declare class SignerEvmAddressReadonly extends SignerEvm {
  private readonly address;
  /**
   * Creates an instance of SignerEvmAddressReadonly.
   *
   * @param client - The client instance used for communication.
   * @param address - The EVM address associated with the signer.
   */
  constructor(client: Client, address: HexLike);
  /**
   * Connects to the client. This implementation does nothing as the class is read-only.
   *
   * @returns A promise that resolves when the connection is complete.
   *
   * @example
   * ```typescript
   * await signer.connect();
   * ```
   */
  connect(): Promise<void>;
  /**
   * Check if the signer is connected.
   *
   * @returns A promise that resolves the connection status.
   */
  isConnected(): Promise<boolean>;
  /**
   * Gets the EVM account associated with the signer.
   *
   * @returns A promise that resolves to a string representing the EVM account.
   *
   * @example
   * ```typescript
   * const account = await signer.getEvmAccount(); // Outputs the EVM account
   * ```
   */
  getEvmAccount(): Promise<Hex>;
}
//#endregion
//#region src/signer/evm/verify.d.ts
/**
 * @public
 */
declare function verifyMessageEvmPersonal(message: string | BytesLike, signature: string, address: string): boolean;
//#endregion
//#region src/signer/nostr/signerNostr.d.ts
/**
 * @public
 */
interface NostrEvent {
  id?: string;
  pubkey?: string;
  sig?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}
/**
 * @public
 */
declare abstract class SignerNostr extends Signer {
  static CKB_SIG_HASH_ALL_TAG: string;
  static CKB_UNLOCK_EVENT_KIND: number;
  static CKB_UNLOCK_EVENT_CONTENT: string;
  get type(): SignerType;
  get signType(): SignerSignType;
  /**
   * Gets the Nostr public key associated with the signer.
   *
   * @returns A promise that resolves to a string representing the Nostr public key.
   */
  abstract getNostrPublicKey(): Promise<Hex>;
  /**
   * Sign a nostr event.
   *
   * @returns A promise that resolves to the signed event.
   */
  signNostrEvent(_event: NostrEvent): Promise<Required<NostrEvent>>;
  /**
   * Sign a message.
   *
   * @returns A promise that resolves to the signature.
   */
  signMessageRaw(message: string | BytesLike): Promise<Hex>;
  /**
   * Gets the internal address, which is the EVM account in this case.
   *
   * @returns A promise that resolves to a string representing the internal address.
   */
  getInternalAddress(): Promise<string>;
  /**
   * Gets an array of Address objects representing the known script addresses for the signer.
   *
   * @returns A promise that resolves to an array of Address objects.
   */
  getAddressObjs(): Promise<Address[]>;
  /**
   * prepare a transaction before signing.
   *
   * @param txLike - The transaction to prepare, represented as a TransactionLike object.
   * @returns A promise that resolves to the prepared Transaction object.
   */
  prepareTransaction(txLike: TransactionLike): Promise<Transaction>;
  /**
   * Signs a transaction without modifying it.
   *
   * @param txLike - The transaction to sign, represented as a TransactionLike object.
   * @returns A promise that resolves to a signed Transaction object.
   */
  signOnlyTransaction(txLike: TransactionLike): Promise<Transaction>;
}
//#endregion
//#region src/signer/nostr/signerNostrPublicKeyReadonly.d.ts
/**
 * Signer from Nostr public key
 * Support npub and hex format
 */
declare class SignerNostrPublicKeyReadonly extends SignerNostr {
  readonly publicKey: Hex;
  constructor(client: Client, publicKey: HexLike);
  connect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getNostrPublicKey(): Promise<Hex>;
}
//#endregion
//#region src/signer/nostr/signerNostrPrivateKey.d.ts
/**
 * Signer from Nostr private key
 * Support nsec and hex format
 */
declare class SignerNostrPrivateKey extends SignerNostrPublicKeyReadonly {
  private readonly privateKey;
  constructor(client: Client, privateKeyLike: BytesLike);
  signNostrEvent(event: NostrEvent): Promise<Required<NostrEvent>>;
}
//#endregion
//#region src/signer/nostr/verify.d.ts
/**
 * @public
 */
declare function buildNostrEventFromMessage(message: string | BytesLike): NostrEvent;
declare function nostrEventHash(event: NostrEvent): Bytes$1;
declare function verifyMessageNostrEvent(message: string | BytesLike, signature: string, address: string): boolean;
declare namespace barrel_d_exports {
  export { Address, AddressLike, Bytes$1 as Bytes, BytesLike, Cell, CellAny, CellAnyLike, CellDep, CellDepInfo, CellDepInfoLike, CellDepLike, CellDepVec, CellInput, CellInputLike, CellInputVec, CellLike, CellOutput, CellOutputLike, CellOutputVec, Client, ClientBlock, ClientBlockHeader, ClientBlockHeaderLike, ClientBlockLike, ClientBlockUncle, ClientBlockUncleLike, ClientCache, ClientCacheMemory, ClientFindCellsResponse, ClientFindTransactionsGroupedResponse, ClientFindTransactionsResponse, ClientIndexerSearchKey, ClientIndexerSearchKeyFilter, ClientIndexerSearchKeyFilterLike, ClientIndexerSearchKeyLike, ClientIndexerSearchKeyTransaction, ClientIndexerSearchKeyTransactionLike, ClientJsonRpc, ClientJsonRpcConfig, ClientPublicMainnet, ClientPublicTestnet, ClientTransactionResponse, ClientTransactionResponseLike, Codec, CodecBool, CodecByte, CodecByte16, CodecByte32, CodecByte4, CodecByte8, CodecBytes, CodecLike, CodecRaw, CodecUint128, CodecUint128BE, CodecUint128LE, CodecUint16, CodecUint16BE, CodecUint16LE, CodecUint256, CodecUint256BE, CodecUint256LE, CodecUint32, CodecUint32BE, CodecUint32LE, CodecUint512, CodecUint512BE, CodecUint512LE, CodecUint64, CodecUint64BE, CodecUint64LE, CodecUint8, Constructor, DecodedType, DepType, DepTypeCodec, DepTypeLike, EncodableType, Entity, Epoch, EpochLike, ErrorClientBase, ErrorClientBaseLike, ErrorClientDuplicatedTransaction, ErrorClientMaxFeeRateExceeded, ErrorClientRBFRejected, ErrorClientResolveUnknown, ErrorClientVerification, ErrorClientWaitTransactionTimeout, ErrorTransactionInsufficientCapacity, ErrorTransactionInsufficientCoin, FixedPoint, FixedPointLike, HASH_CKB_LENGTH, HASH_CKB_SHORT_LENGTH, HashType, HashTypeCodec, HashTypeLike, Hasher, HasherCkb, HasherKeecak256, Hex, HexLike, InputToSign, InputToSignLike, KnownScript, LumosTransactionSkeletonType, MultisigCkbWitness, MultisigCkbWitnessLike, NetworkPreference, NostrEvent, Num, NumLike, One, OutPoint, OutPointLike, OutputsValidator, RawTransaction, RequestorJsonRpc, RequestorJsonRpcConfig, SECP256K1_SIGNATURE_LENGTH, Script, ScriptInfo, ScriptInfoLike, ScriptLike, ScriptOpt, ScriptVec, SignPsbtOptions, SignPsbtOptionsLike, Signature, Signer, SignerAlwaysError, SignerBtc, SignerBtcPublicKeyReadonly, SignerCkbPrivateKey, SignerCkbPublicKey, SignerCkbScriptReadonly, SignerDoge, SignerDogeAddressReadonly, SignerDogePrivateKey, SignerDummy, SignerEvm, SignerEvmAddressReadonly, SignerInfo, SignerMultisig, SignerMultisigCkbPrivateKey, SignerMultisigCkbReadonly, SignerMultisigNotEnoughSignaturesError, SignerNostr, SignerNostrPrivateKey, SignerNostrPublicKeyReadonly, SignerOpenLink, SignerSignType, SignerType, Since, SinceLike, Transaction, TransactionLike, TransactionStatus, Wallet, WitnessArgs, WitnessArgsLike, Zero, apply, btcEcdsaPublicKeyHash, btcP2pkhAddressFromPublicKey, btcPublicKeyFromP2pkhAddress, btcVarLengthBytesFrom, buildNostrEventFromMessage, bytesConcat, bytesConcatTo, bytesEq, bytesFrom, bytesLen, bytesLenUnsafe, bytesTo, calcDaoClaimEpoch, calcDaoProfit, codec, codecPadding, codecUint, codecUintNumber, depTypeFrom, depTypeFromBytes, depTypeToBytes, epochFrom, epochFromHex, epochToHex, fixedPointFrom, fixedPointToString, gcd, hashCkb, hashCkbShort, hashTypeFrom, hashTypeFromBytes, hashTypeId, hashTypeToBytes, hexFrom, isDaoOutputLimitExceeded, isWebview, keystoreDecrypt, keystoreEncrypt, messageHashBtcEcdsa, messageHashCkbSecp256k1, messageHashDogeEcdsa, barrel_d_exports$1 as mol, nostrEventHash, numBeFromBytes, numBeToBytes, numFrom, numFromBytes, numLeFromBytes, numLeToBytes, numMax, numMin, numToBytes, numToHex, recoverMessageSecp256k1, reduceAsync, signMessageSecp256k1, sleep, stringify, udtBalanceFrom, verifyMessageBtcEcdsa, verifyMessageCkbSecp256k1, verifyMessageDogeEcdsa, verifyMessageEvmPersonal, verifyMessageJoyId, verifyMessageNostrEvent, verifyMessageSecp256k1 };
}
//#endregion
//#region src/client/clientTypes.advanced.d.ts
declare const DEFAULT_MAX_FEE_RATE: bigint;
declare const DEFAULT_MIN_FEE_RATE: bigint;
declare function clientSearchKeyRangeFrom([a, b]: [NumLike, NumLike]): [Num, Num];
type ClientCollectableSearchKeyFilterLike = {
  script?: ScriptLike | null;
  scriptLenRange?: [NumLike, NumLike] | null;
  outputData?: HexLike | null;
  outputDataSearchMode?: "prefix" | "exact" | "partial" | null;
  outputDataLenRange?: [NumLike, NumLike] | null;
  outputCapacityRange?: [NumLike, NumLike] | null;
};
type ClientCollectableSearchKeyLike = {
  script: ScriptLike;
  scriptType: "lock" | "type";
  scriptSearchMode: "prefix" | "exact" | "partial";
  filter?: ClientCollectableSearchKeyFilterLike | null;
  withData?: boolean | null;
};
//#endregion
//#region src/client/clientTypes.d.ts
/**
 * @public
 */
type CellDepInfoLike = {
  cellDep: CellDepLike;
  type?: ScriptLike | null;
};
/**
 * @public
 */
declare class CellDepInfo {
  cellDep: CellDep;
  type?: Script | undefined;
  constructor(cellDep: CellDep, type?: Script | undefined);
  static from(cellDepInfoLike: CellDepInfoLike): CellDepInfo;
}
/**
 * @public
 */
type ScriptInfoLike = {
  codeHash: HexLike;
  hashType: HashTypeLike;
  cellDeps: CellDepInfoLike[];
};
/**
 * @public
 */
declare class ScriptInfo {
  codeHash: Hex;
  hashType: HashType;
  cellDeps: CellDepInfo[];
  constructor(codeHash: Hex, hashType: HashType, cellDeps: CellDepInfo[]);
  static from(scriptInfoLike: ScriptInfoLike): ScriptInfo;
}
/**
 * @public
 */
type OutputsValidator = "passthrough" | "well_known_scripts_only";
/**
 * @public
 */
type TransactionStatus = "sent" | "pending" | "proposed" | "committed" | "unknown" | "rejected";
/**
 * @public
 */
type ClientTransactionResponseLike = {
  transaction: TransactionLike;
  status: TransactionStatus;
  cycles?: NumLike;
  blockHash?: HexLike;
  blockNumber?: NumLike;
  txIndex?: NumLike;
  reason?: string;
};
/**
 * @public
 */
declare class ClientTransactionResponse {
  transaction: Transaction;
  status: TransactionStatus;
  cycles?: Num | undefined;
  blockHash?: Hex | undefined;
  blockNumber?: Num | undefined;
  txIndex?: Num | undefined;
  reason?: string | undefined;
  constructor(transaction: Transaction, status: TransactionStatus, cycles?: Num | undefined, blockHash?: Hex | undefined, blockNumber?: Num | undefined, txIndex?: Num | undefined, reason?: string | undefined);
  static from(responseLike: ClientTransactionResponseLike): ClientTransactionResponse;
  clone(): ClientTransactionResponse;
}
/**
 * @public
 */
type ClientIndexerSearchKeyFilterLike = ClientCollectableSearchKeyFilterLike & {
  blockRange?: [NumLike, NumLike] | null;
};
/**
 * @public
 */
declare class ClientIndexerSearchKeyFilter {
  script: Script | undefined;
  scriptLenRange: [Num, Num] | undefined;
  outputData: Hex | undefined;
  outputDataSearchMode: "prefix" | "exact" | "partial" | undefined;
  outputDataLenRange: [Num, Num] | undefined;
  outputCapacityRange: [Num, Num] | undefined;
  blockRange: [Num, Num] | undefined;
  constructor(script: Script | undefined, scriptLenRange: [Num, Num] | undefined, outputData: Hex | undefined, outputDataSearchMode: "prefix" | "exact" | "partial" | undefined, outputDataLenRange: [Num, Num] | undefined, outputCapacityRange: [Num, Num] | undefined, blockRange: [Num, Num] | undefined);
  static from(filterLike: ClientIndexerSearchKeyFilterLike): ClientIndexerSearchKeyFilter;
}
/**
 * @public
 */
type ClientIndexerSearchKeyLike = ClientCollectableSearchKeyLike & {
  filter?: ClientIndexerSearchKeyFilterLike | null;
};
/**
 * @public
 */
declare class ClientIndexerSearchKey {
  script: Script;
  scriptType: "lock" | "type";
  scriptSearchMode: "prefix" | "exact" | "partial";
  filter: ClientIndexerSearchKeyFilter | undefined;
  withData: boolean | undefined;
  constructor(script: Script, scriptType: "lock" | "type", scriptSearchMode: "prefix" | "exact" | "partial", filter: ClientIndexerSearchKeyFilter | undefined, withData: boolean | undefined);
  static from(keyLike: ClientIndexerSearchKeyLike): ClientIndexerSearchKey;
}
/**
 * @public
 */
type ClientFindCellsResponse = {
  lastCursor: string;
  cells: Cell[];
};
/**
 * @public
 */
type ClientIndexerSearchKeyTransactionLike = Omit<ClientCollectableSearchKeyLike, "withData"> & {
  filter?: ClientIndexerSearchKeyFilterLike | null;
  groupByTransaction?: boolean | null;
};
/**
 * @public
 */
declare class ClientIndexerSearchKeyTransaction {
  script: Script;
  scriptType: "lock" | "type";
  scriptSearchMode: "prefix" | "exact" | "partial";
  filter: ClientIndexerSearchKeyFilter | undefined;
  groupByTransaction: boolean | undefined;
  constructor(script: Script, scriptType: "lock" | "type", scriptSearchMode: "prefix" | "exact" | "partial", filter: ClientIndexerSearchKeyFilter | undefined, groupByTransaction: boolean | undefined);
  static from(keyLike: ClientIndexerSearchKeyTransactionLike): ClientIndexerSearchKeyTransaction;
}
/**
 * @public
 */
type ClientFindTransactionsResponse = {
  lastCursor: string;
  transactions: {
    txHash: Hex;
    blockNumber: Num;
    txIndex: Num;
    isInput: boolean;
    cellIndex: Num;
  }[];
};
/**
 * @public
 */
type ClientFindTransactionsGroupedResponse = {
  lastCursor: string;
  transactions: {
    txHash: Hex;
    blockNumber: Num;
    txIndex: Num;
    cells: {
      isInput: boolean;
      cellIndex: Num;
    }[];
  }[];
};
/**
 * @public
 */
type ClientBlockHeaderLike = {
  compactTarget: NumLike;
  dao: {
    /**
     * C_i: the total issuance up to and including block i.
     */
    c: NumLike;
    /**
     * AR_i: the current accumulated rate at block i.
     * AR_j / AR_i reflects the CKByte amount if one deposit 1 CKB to Nervos DAO at block i, and withdraw at block j.
     */
    ar: NumLike;
    /**
     * S_i: the total unissued secondary issuance up to and including block i,
     * including unclaimed Nervos DAO compensation and treasury funds.
     */
    s: NumLike;
    /**
     * U_i: the total occupied capacities currently in the blockchain up to and including block i.
     * Occupied capacity is the sum of capacities used to store all cells.
     */
    u: NumLike;
  };
  epoch: EpochLike;
  extraHash: HexLike;
  hash: HexLike;
  nonce: NumLike;
  number: NumLike;
  parentHash: HexLike;
  proposalsHash: HexLike;
  timestamp: NumLike;
  transactionsRoot: HexLike;
  version: NumLike;
};
/**
 * @public
 */
declare class ClientBlockHeader {
  compactTarget: Num;
  dao: {
    /**
     * C_i: the total issuance up to and including block i.
     */
    c: Num;
    /**
     * AR_i: the current accumulated rate at block i.
     * AR_j / AR_i reflects the CKByte amount if one deposit 1 CKB to Nervos DAO at block i, and withdraw at block j.
     */
    ar: Num;
    /**
     * S_i: the total unissued secondary issuance up to and including block i,
     * including unclaimed Nervos DAO compensation and treasury funds.
     */
    s: Num;
    /**
     * U_i: the total occupied capacities currently in the blockchain up to and including block i.
     * Occupied capacity is the sum of capacities used to store all cells.
     */
    u: Num;
  };
  epoch: Epoch;
  extraHash: Hex;
  hash: Hex;
  nonce: Num;
  number: Num;
  parentHash: Hex;
  proposalsHash: Hex;
  timestamp: Num;
  transactionsRoot: Hex;
  version: Num;
  constructor(compactTarget: Num, dao: {
    /**
     * C_i: the total issuance up to and including block i.
     */
    c: Num;
    /**
     * AR_i: the current accumulated rate at block i.
     * AR_j / AR_i reflects the CKByte amount if one deposit 1 CKB to Nervos DAO at block i, and withdraw at block j.
     */
    ar: Num;
    /**
     * S_i: the total unissued secondary issuance up to and including block i,
     * including unclaimed Nervos DAO compensation and treasury funds.
     */
    s: Num;
    /**
     * U_i: the total occupied capacities currently in the blockchain up to and including block i.
     * Occupied capacity is the sum of capacities used to store all cells.
     */
    u: Num;
  }, epoch: Epoch, extraHash: Hex, hash: Hex, nonce: Num, number: Num, parentHash: Hex, proposalsHash: Hex, timestamp: Num, transactionsRoot: Hex, version: Num);
  static from(headerLike: ClientBlockHeaderLike): ClientBlockHeader;
}
/**
 * @public
 */
type ClientBlockUncleLike = {
  header: ClientBlockHeaderLike;
  proposals: HexLike[];
};
/**
 * @public
 */
declare class ClientBlockUncle {
  header: ClientBlockHeader;
  proposals: Hex[];
  constructor(header: ClientBlockHeader, proposals: Hex[]);
  static from(uncleLike: ClientBlockUncleLike): ClientBlockUncle;
}
/**
 * @public
 */
type ClientBlockLike = {
  header: ClientBlockHeaderLike;
  proposals: HexLike[];
  transactions: TransactionLike[];
  uncles: ClientBlockUncleLike[];
};
/**
 * @public
 */
declare class ClientBlock {
  header: ClientBlockHeader;
  proposals: Hex[];
  transactions: Transaction[];
  uncles: ClientBlockUncle[];
  constructor(header: ClientBlockHeader, proposals: Hex[], transactions: Transaction[], uncles: ClientBlockUncle[]);
  static from(blockLike: ClientBlockLike): ClientBlock;
}
interface ErrorClientBaseLike {
  message?: string;
  code?: number;
  data: string;
}
declare class ErrorClientBase extends Error {
  readonly code?: number;
  readonly data: string;
  constructor(origin: ErrorClientBaseLike);
}
declare class ErrorClientResolveUnknown extends ErrorClientBase {
  readonly outPoint: OutPoint;
  constructor(origin: ErrorClientBaseLike, outPointLike: OutPointLike);
}
declare class ErrorClientVerification extends ErrorClientBase {
  readonly source: "lock" | "inputType" | "outputType";
  readonly errorCode: number;
  readonly scriptHashType: "data" | "type";
  readonly sourceIndex: Num;
  readonly scriptCodeHash: Hex;
  constructor(origin: ErrorClientBaseLike, source: "lock" | "inputType" | "outputType", sourceIndex: NumLike, errorCode: number, scriptHashType: "data" | "type", scriptCodeHash: HexLike);
}
declare class ErrorClientDuplicatedTransaction extends ErrorClientBase {
  readonly txHash: Hex;
  constructor(origin: ErrorClientBaseLike, txHash: HexLike);
}
declare class ErrorClientRBFRejected extends ErrorClientBase {
  readonly currentFee: Num;
  readonly leastFee: Num;
  constructor(origin: ErrorClientBaseLike, currentFee: NumLike, leastFee: NumLike);
}
declare class ErrorClientWaitTransactionTimeout extends ErrorClientBase {
  constructor(timeoutLike: NumLike);
}
declare class ErrorClientMaxFeeRateExceeded extends ErrorClientBase {
  constructor(limitLike: NumLike, actualLike: NumLike);
}
//#endregion
//#region src/ckb/epoch.d.ts
/**
 * EpochLike
 *
 * Union type that represents any allowed input shapes that can be converted
 * into an Epoch instance.
 *
 * Accepted shapes:
 * - Tuple: [integer, numerator, denominator] where each element is NumLike
 * - Object: { integer, numerator, denominator } where each field is NumLike
 * - Packed numeric form: Num (bigint) or Hex (RPC-style packed hex)
 *
 * Notes:
 * - When constructing an Epoch from a Num or Hex the packed numeric representation
 *   encodes integer (24 bits), numerator (16 bits) and denominator (16 bits).
 * - Use Epoch.from() to convert any EpochLike into an Epoch instance.
 *
 * @example
 * // From tuple
 * Epoch.from([1n, 0n, 1n]);
 */
type EpochLike = [NumLike, NumLike, NumLike] | {
  integer: NumLike;
  numerator: NumLike;
  denominator: NumLike;
} | Num | Hex;
declare const Epoch_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): Epoch;
  eq(other: EpochLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: EpochLike): Bytes$1;
  decode(_: BytesLike): Epoch;
  fromBytes(_bytes: BytesLike): Epoch;
  from(_: EpochLike): Epoch;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * Epoch
 *
 * Represents a blockchain epoch consisting of a whole integer part and an
 * optional fractional part represented as numerator/denominator.
 *
 * Behavior highlights:
 * - Internally stores values as Num (bigint).
 * - Provides normalization routines to canonicalize the fractional part:
 *   - normalizeBase(): fixes zero/negative denominators
 *   - normalizeCanonical(): reduces fraction, borrows/carries whole units
 * - Supports arithmetic (add/sub), comparison and conversion utilities.
 *
 * @example
 * const e = Epoch.from([1n, 1n, 2n]); // 1 + 1/2
 *
 * @remarks
 * This class is primarily a thin value-object; operations return new Epoch instances.
 */
declare class Epoch extends Epoch_base {
  readonly integer: Num;
  readonly numerator: Num;
  readonly denominator: Num;
  /**
   * Construct a new Epoch instance.
   *
   * @param integer - Whole epoch units (Num/bigint)
   * @param numerator - Fractional numerator (Num).
   * @param denominator - Fractional denominator (Num).
   */
  constructor(integer: Num, numerator: Num, denominator: Num);
  /**
   * Normalize simpler base invariants:
   * - If denominator === 0, set denominator to 1 and numerator to 0 for arithmetic convenience.
   * - If denominator is negative flip signs of numerator and denominator to keep denominator positive.
   *
   * This is a minimal correction used before arithmetic or canonical normalization.
   *
   * @returns New Epoch with denominator corrected (but fraction not reduced).
   */
  normalizeBase(): Epoch;
  /**
   * Perform full canonical normalization of the epoch value.
   *
   * Steps:
   * 1. Apply base normalization (normalizeBase).
   * 2. If numerator is negative, borrow whole denominator(s) from the integer part
   *    so numerator becomes non-negative. This ensures 0 <= numerator < denominator whenever possible.
   * 3. Reduce numerator/denominator by their greatest common divisor (gcd).
   * 4. Carry any whole units from the reduced numerator into the integer part.
   * 5. Ensure numerator is the strict remainder (numerator < denominator).
   *
   * @returns Canonicalized Epoch with a non-negative, reduced fractional part and integer adjusted accordingly.
   */
  normalizeCanonical(): Epoch;
  /**
   * Backwards-compatible array-style index 0 referencing the whole epoch integer.
   *
   * @returns integer portion (Num)
   * @deprecated Use `.integer` property instead.
   */
  get 0(): Num;
  /**
   * Backwards-compatible array-style index 1 referencing the epoch fractional numerator.
   *
   * @returns numerator portion (Num)
   * @deprecated Use `.numerator` property instead.
   */
  get 1(): Num;
  /**
   * Backwards-compatible array-style index 2 referencing the epoch fractional denominator.
   *
   * @returns denominator portion (Num)
   * @deprecated Use `.denominator` property instead.
   */
  get 2(): Num;
  /**
   * Convert this Epoch into its RPC-style packed numeric representation (Num).
   *
   * Packing layout (little-endian style fields):
   * - integer: lower 24 bits
   * - numerator: next 16 bits
   * - denominator: next 16 bits
   *
   * Throws if any component is negative since packed representation assumes non-negative components.
   *
   * @throws {Error} If integer, numerator or denominator are negative.
   * @throws {Error} If integer, numerator or denominator overflow the packing limits.
   * @returns Packed numeric representation (Num) suitable for RPC packing.
   */
  toNum(): Num;
  /**
   * Convert epoch to hex string representation of the RPC-style packed numeric form.
   *
   * Returns the same representation used by CKB RPC responses where the
   * packed numeric bytes may be trimmed of leading zeros, see {@link numToHex}
   *
   * @returns Hex string corresponding to the packed epoch.
   */
  toPackedHex(): Hex;
  /**
   * Construct an Epoch by unpacking a RPC-style packed numeric form.
   *
   * @param v - NumLike packed epoch (like Num and Hex)
   * @returns Epoch whose integer, numerator and denominator are extracted from the packed layout.
   */
  static fromNum(v: NumLike): Epoch;
  /**
   * Create an Epoch from an EpochLike value.
   *
   * Accepts:
   * - an Epoch instance (returned as-is)
   * - an array [integer, numerator, denominator] where each element is NumLike
   * - an object { integer, numerator, denominator } where each field is NumLike
   * - a packed numeric-like value handled by fromNum
   *
   * All numeric-like inputs are converted with numFrom() to produce internal Num values.
   *
   * @param e - Value convertible to Epoch
   * @returns Epoch instance
   */
  static from(e: EpochLike): Epoch;
  /**
   * Return a deep copy of this Epoch.
   *
   * @returns New Epoch instance with identical components.
   */
  clone(): Epoch;
  /**
   * Return the genesis epoch.
   *
   * Note: for historical reasons the genesis epoch is represented with all-zero
   * fields, no other epoch instance should use a zero denominator.
   *
   * @returns Epoch with integer = 0, numerator = 0, denominator = 0.
   */
  static get Genesis(): Epoch;
  /**
   * Return an Epoch representing one Nervos DAO cycle (180 epochs exactly).
   *
   * @returns Epoch equal to 180 with denominator set to 1 to represent an exact whole unit.
   */
  static get OneNervosDaoCycle(): Epoch;
  /**
   * Compare this epoch to another EpochLike.
   *
   * The comparison computes scaled integer values so fractions are compared without precision loss:
   *   scaled = (integer * denominator + numerator) * other.denominator
   *
   * Special-case: identical object references return equality immediately.
   *
   * @param other - Epoch-like value to compare against.
   * @returns 1 if this > other, 0 if equal, -1 if this < other.
   *
   * @example
   * epochA.compare(epochB); // -1|0|1
   */
  compare(other: EpochLike): 1 | 0 | -1;
  /**
   * Check whether this epoch is less than another EpochLike.
   *
   * @param other - EpochLike to compare against.
   * @returns true if this < other.
   */
  lt(other: EpochLike): boolean;
  /**
   * Check whether this epoch is less than or equal to another EpochLike.
   *
   * @param other - EpochLike to compare against.
   * @returns true if this <= other.
   */
  le(other: EpochLike): boolean;
  /**
   * Check whether this epoch equals another EpochLike.
   *
   * @param other - EpochLike to compare against.
   * @returns true if equal.
   */
  eq(other: EpochLike): boolean;
  /**
   * Check whether this epoch is greater than or equal to another EpochLike.
   *
   * @param other - EpochLike to compare against.
   * @returns true if this >= other.
   */
  ge(other: EpochLike): boolean;
  /**
   * Check whether this epoch is greater than another EpochLike.
   *
   * @param other - EpochLike to compare against.
   * @returns true if this > other.
   */
  gt(other: EpochLike): boolean;
  /**
   * Add another EpochLike to this epoch and return the normalized result.
   *
   * Rules and edge-cases:
   * - Whole parts are added directly; fractional parts are aligned to a common denominator and added.
   * - Final result is canonicalized to reduce the fraction and carry any overflow to the integer part.
   *
   * @param other - Epoch-like value to add.
   * @returns Normalized Epoch representing the sum.
   */
  add(other: EpochLike): Epoch;
  /**
   * Subtract an EpochLike from this epoch and return the normalized result.
   *
   * Implementation notes:
   * - Delegates to add by negating the other epoch's integer and numerator while preserving denominator.
   * - normalizeCanonical will handle negative numerators by borrowing from integer as necessary.
   *
   * @param other - Epoch-like value to subtract.
   * @returns Normalized Epoch representing this - other.
   */
  sub(other: EpochLike): Epoch;
  /**
   * Convert this epoch to an estimated Unix timestamp in milliseconds using a reference header.
   *
   * Note: This is an estimation that assumes a constant epoch duration.
   *
   * @param reference - Object providing `epoch` (Epoch) and `timestamp` (Num) fields, such as a ClientBlockHeader.
   * @param epochInMilliseconds - Duration of a single epoch in milliseconds. Defaults to 4 hours.
   * @returns Estimated Unix timestamp in milliseconds as bigint.
   */
  toUnix(reference: Pick<ClientBlockHeader, "epoch" | "timestamp">, epochInMilliseconds?: Num): bigint;
}
/**
 * epochFrom
 *
 * @deprecated prefer using Epoch.from() directly.
 *
 * @param epochLike - Epoch-like value to convert.
 * @returns Epoch instance corresponding to the input.
 */
declare function epochFrom(epochLike: EpochLike): Epoch;
/**
 * epochFromHex
 *
 * @deprecated use Epoch.fromNum() with numeric input instead.
 *
 * @param hex - Hex-like or numeric-like value encoding a packed epoch.
 * @returns Decoded Epoch instance.
 */
declare function epochFromHex(hex: HexLike): Epoch;
/**
 * epochToHex
 *
 * @deprecated use Epoch.from(epochLike).toPackedHex() instead.
 *
 * @param epochLike - Value convertible to an Epoch (object, tuple or Epoch).
 * @returns Hex string representing the packed epoch encoding.
 */
declare function epochToHex(epochLike: EpochLike): Hex;
//#endregion
//#region src/client/knownScript.d.ts
/**
 * @public
 */
declare enum KnownScript {
  NervosDao = "NervosDao",
  Secp256k1Blake160 = "Secp256k1Blake160",
  Secp256k1Multisig = "Secp256k1Multisig",
  Secp256k1MultisigV2Beta = "Secp256k1MultisigV2Beta",
  // Fix rare failing case (https://github.com/nervosnetwork/ckb-system-scripts/pull/98)
  Secp256k1MultisigV2 = "Secp256k1MultisigV2",
  // Enhanced since handling (https://github.com/nervosnetwork/ckb-system-scripts/pull/99)
  AnyoneCanPay = "AnyoneCanPay",
  TypeId = "TypeId",
  SUdt = "SUdt",
  XUdt = "XUdt",
  JoyId = "JoyId",
  COTA = "COTA",
  PWLock = "PWLock",
  OmniLock = "OmniLock",
  NostrLock = "NostrLock",
  UniqueType = "UniqueType",
  DidCkb = "DidCkb",
  AlwaysSuccess = "AlwaysSuccess",
  InputTypeProxyLock = "InputTypeProxyLock",
  OutputTypeProxyLock = "OutputTypeProxyLock",
  LockProxyLock = "LockProxyLock",
  SingleUseLock = "SingleUseLock",
  TypeBurnLock = "TypeBurnLock",
  EasyToDiscoverType = "EasyToDiscoverType",
  TimeLock = "TimeLock"
}
//#endregion
//#region src/ckb/script.d.ts
declare const HashTypeCodec: Codec<HashTypeLike, HashType>;
/**
 * @public
 */
type HashTypeLike = string | number | bigint;
/**
 * @public
 */
type HashType = "type" | "data" | "data1" | "data2";
/**
 * Converts a HashTypeLike value to a HashType.
 * @public
 *
 * @param val - The value to convert, which can be a string, number, or bigint.
 * @returns The corresponding HashType.
 *
 * @throws Will throw an error if the input value is not a valid hash type.
 *
 * @example
 * ```typescript
 * const hashType = hashTypeFrom(1); // Outputs "data"
 * const hashType = hashTypeFrom("type"); // Outputs "type"
 * ```
 */
declare function hashTypeFrom(val: HashTypeLike): HashType;
/**
 * Converts a HashTypeLike value to its corresponding byte representation.
 * @public
 *
 * @param hashType - The hash type value to convert.
 * @returns A Uint8Array containing the byte representation of the hash type.
 *
 * @example
 * ```typescript
 * const hashTypeBytes = hashTypeToBytes("type"); // Outputs Uint8Array [0]
 * ```
 */
declare function hashTypeToBytes(hashType: HashTypeLike): Bytes$1;
/**
 * Converts a byte-like value to a HashType.
 * @public
 *
 * @param bytes - The byte-like value to convert.
 * @returns The corresponding HashType.
 *
 * @throws Will throw an error if the input bytes do not correspond to a valid hash type.
 *
 * @example
 * ```typescript
 * const hashType = hashTypeFromBytes(new Uint8Array([0])); // Outputs "type"
 * ```
 */
declare function hashTypeFromBytes(bytes: BytesLike): HashType;
/**
 * @public
 */
type ScriptLike = {
  codeHash: BytesLike;
  hashType: HashTypeLike;
  args: BytesLike;
};
declare const Script_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): Script;
  eq(other: ScriptLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: ScriptLike): Bytes$1;
  decode(_: BytesLike): Script;
  fromBytes(_bytes: BytesLike): Script;
  from(_: ScriptLike): Script;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class Script extends Script_base {
  codeHash: Hex;
  hashType: HashType;
  args: Hex;
  /**
   * Creates an instance of Script.
   *
   * @param codeHash - The code hash of the script.
   * @param hashType - The hash type of the script.
   * @param args - The arguments for the script.
   */
  constructor(codeHash: Hex, hashType: HashType, args: Hex);
  get occupiedSize(): number;
  /**
   * Clone a script.
   *
   * @returns A cloned Script instance.
   *
   * @example
   * ```typescript
   * const script1 = script0.clone();
   * ```
   */
  clone(): Script;
  /**
   * Check if the script is equal to another script.
   * @public
   * @param other - The other script to compare with
   * @returns True if the scripts are equal, false otherwise
   *
   * @example
   * ```typescript
   * const isEqual = script0.eq(script1);
   * ```
   */
  eq(other: ScriptLike): boolean;
  /**
   * Creates a Script instance from a ScriptLike object.
   *
   * @param script - A ScriptLike object or an instance of Script.
   * @returns A Script instance.
   *
   * @example
   * ```typescript
   * const script = Script.from({
   *   codeHash: "0x1234...",
   *   hashType: "type",
   *   args: "0xabcd..."
   * });
   * ```
   */
  static from(script: ScriptLike): Script;
  /**
   * Creates a Script instance from client and known script.
   *
   * @param knownScript - A KnownScript enum.
   * @param args - Args for the script.
   * @param client - A ScriptLike object or an instance of Script.
   * @returns A promise that resolves to the script instance.
   *
   * @example
   * ```typescript
   * const script = await Script.fromKnownScript(
   *   client,
   *   KnownScript.XUdt,
   *   args: "0xabcd..."
   * );
   * ```
   */
  static fromKnownScript(client: Client, knownScript: KnownScript, args: HexLike): Promise<Script>;
}
declare const ScriptOpt: Codec<ScriptLike | null | undefined, Script | undefined>;
declare const ScriptVec: Codec<ScriptLike[], Script[]>;
//#endregion
//#region src/ckb/transactionLumos.d.ts
interface LumosTransactionSkeletonType {
  cellDeps: {
    toArray(): CellDepLike[];
  };
  headerDeps: {
    toArray(): HexLike[];
  };
  inputs: {
    toArray(): {
      outPoint?: OutPointLike;
      cellOutput: CellOutputLike;
      data: HexLike;
    }[];
  };
  inputSinces: {
    get(i: number, defaultVal: string): HexLike;
  };
  outputs: {
    toArray(): {
      cellOutput: CellOutputLike;
      data: HexLike;
    }[];
  };
  witnesses: {
    toArray(): HexLike[];
  };
}
//#endregion
//#region src/ckb/transaction.d.ts
declare const DepTypeCodec: Codec<DepTypeLike, DepType>;
/**
 * @public
 */
type DepTypeLike = string | number | bigint;
/**
 * @public
 */
type DepType = "depGroup" | "code";
/**
 * Converts a DepTypeLike value to a DepType.
 * @public
 *
 * @param val - The value to convert, which can be a string, number, or bigint.
 * @returns The corresponding DepType.
 *
 * @throws Will throw an error if the input value is not a valid dep type.
 *
 * @example
 * ```typescript
 * const depType = depTypeFrom(1); // Outputs "code"
 * const depType = depTypeFrom("depGroup"); // Outputs "depGroup"
 * ```
 */
declare function depTypeFrom(val: DepTypeLike): DepType;
/**
 * Converts a DepTypeLike value to its corresponding byte representation.
 * @public
 *
 * @param depType - The dep type value to convert.
 * @returns A Uint8Array containing the byte representation of the dep type.
 *
 * @example
 * ```typescript
 * const depTypeBytes = depTypeToBytes("code"); // Outputs Uint8Array [1]
 * ```
 */
declare function depTypeToBytes(depType: DepTypeLike): Bytes$1;
/**
 * Converts a byte-like value to a DepType.
 * @public
 *
 * @param bytes - The byte-like value to convert.
 * @returns The corresponding DepType.
 *
 * @throws Will throw an error if the input bytes do not correspond to a valid dep type.
 *
 * @example
 * ```typescript
 * const depType = depTypeFromBytes(new Uint8Array([1])); // Outputs "code"
 * ```
 */
declare function depTypeFromBytes(bytes: BytesLike): DepType;
/**
 * @public
 */
type OutPointLike = {
  txHash: HexLike;
  index: NumLike;
};
declare const OutPoint_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): OutPoint;
  eq(other: OutPointLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: OutPointLike): Bytes$1;
  decode(_: BytesLike): OutPoint;
  fromBytes(_bytes: BytesLike): OutPoint;
  from(_: OutPointLike): OutPoint;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class OutPoint extends OutPoint_base {
  txHash: Hex;
  index: Num;
  /**
   * Creates an instance of OutPoint.
   *
   * @param txHash - The transaction hash.
   * @param index - The index of the output in the transaction.
   */
  constructor(txHash: Hex, index: Num);
  /**
   * Creates an OutPoint instance from an OutPointLike object.
   *
   * @param outPoint - An OutPointLike object or an instance of OutPoint.
   * @returns An OutPoint instance.
   *
   * @example
   * ```typescript
   * const outPoint = OutPoint.from({ txHash: "0x...", index: 0 });
   * ```
   */
  static from(outPoint: OutPointLike): OutPoint;
  /**
   * Clone a OutPoint.
   *
   * @returns A cloned OutPoint instance.
   *
   * @example
   * ```typescript
   * const outPoint1 = outPoint0.clone();
   * ```
   */
  clone(): OutPoint;
  /**
   * Check if the OutPoint is equal to another OutPoint.
   * @public
   * @param other - The other OutPoint to compare with
   * @returns True if the OutPoints are equal, false otherwise
   *
   * @example
   * ```typescript
   * const isEqual = outPoint0.eq(outPoint1);
   * ```
   */
  eq(other: OutPointLike): boolean;
}
/**
 * @public
 */
type CellOutputLike = {
  capacity?: NumLike | null;
  lock: ScriptLike;
  type?: ScriptLike | null;
};
declare const CellOutput_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): CellOutput;
  eq(other: CellOutputLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: CellOutputLike): Bytes$1;
  decode(_: BytesLike): CellOutput;
  fromBytes(_bytes: BytesLike): CellOutput;
  from(_: CellOutputLike): CellOutput;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class CellOutput extends CellOutput_base {
  capacity: Num;
  lock: Script;
  type?: Script | undefined;
  /**
   * Creates an instance of CellOutput.
   *
   * @param capacity - The capacity of the cell.
   * @param lock - The lock script of the cell.
   * @param type - The optional type script of the cell.
   */
  constructor(capacity: Num, lock: Script, type?: Script | undefined);
  get occupiedSize(): number;
  /**
   * Creates a CellOutput instance from a CellOutputLike object.
   * This method supports automatic capacity calculation when outputData is provided and capacity is 0 or omitted.
   *
   * @param cellOutput - A CellOutputLike object or an instance of CellOutput.
   * @param outputData - Optional output data used for automatic capacity calculation.
   *                     When provided and capacity is 0, the capacity will be calculated
   *                     as occupiedSize + outputData.length.
   * @returns A CellOutput instance.
   *
   * @example
   * ```typescript
   * // Basic usage with explicit capacity
   * const cellOutput1 = CellOutput.from({
   *   capacity: 1000n,
   *   lock: { codeHash: "0x...", hashType: "type", args: "0x..." },
   *   type: { codeHash: "0x...", hashType: "type", args: "0x..." }
   * });
   *
   * // Automatic capacity calculation
   * const cellOutput2 = CellOutput.from({
   *   lock: { codeHash: "0x...", hashType: "type", args: "0x..." }
   * }, "0x1234"); // Capacity will be calculated automatically
   * ```
   */
  static from(cellOutput: CellOutputLike, outputData?: HexLike | null): CellOutput;
  /**
   * Clone a CellOutput.
   *
   * @returns A cloned CellOutput instance.
   *
   * @example
   * ```typescript
   * const cellOutput1 = cellOutput0.clone();
   * ```
   */
  clone(): CellOutput;
}
declare const CellOutputVec: Codec<CellOutputLike[], CellOutput[]>;
/**
 * @public
 * Represents a cell-like object that may or may not be on-chain.
 * It can optionally have an `outPoint` (or `previousOutput`).
 * This is used as a flexible input for creating `CellAny` instances.
 * @see CellAny
 */
type CellAnyLike = {
  outPoint?: OutPointLike | null;
  previousOutput?: OutPointLike | null;
  cellOutput: CellOutputLike;
  outputData?: HexLike | null;
};
/**
 * Represents a CKB cell that can be either on-chain (with an `outPoint`) or off-chain (without an `outPoint`).
 * This class provides a unified interface for handling cells before they are included in a transaction,
 * or for cells that are already part of the blockchain state.
 *
 * @public
 */
declare class CellAny {
  cellOutput: CellOutput;
  outputData: Hex;
  outPoint: OutPoint | undefined;
  /**
   * Creates an instance of CellAny.
   *
   * @param cellOutput - The cell output of the cell.
   * @param outputData - The output data of the cell.
   * @param outPoint - The optional output point of the cell. If provided, the cell is considered on-chain.
   */
  constructor(cellOutput: CellOutput, outputData: Hex, outPoint?: OutPoint);
  /**
   * Creates a `CellAny` instance from a `CellAnyLike` object.
   * This factory method provides a convenient way to create `CellAny` instances
   * from plain objects, automatically handling the optional `outPoint` or `previousOutput`.
   *
   * @param cell - A `CellAnyLike` object.
   * @returns A new `CellAny` instance.
   *
   * @example
   * ```typescript
   * // Create an off-chain cell (e.g., a new output)
   * const offChainCell = CellAny.from({
   *   cellOutput: { capacity: 1000n, lock: lockScript },
   *   outputData: "0x"
   * });
   *
   * // Create an on-chain cell from an input
   * const onChainCell = CellAny.from({
   *   outPoint: { txHash: "0x...", index: 0 },
   *   cellOutput: { capacity: 2000n, lock: lockScript },
   *   outputData: "0x1234"
   * });
   * ```
   */
  static from(cell: CellAnyLike): CellAny;
  /**
   * Calculates the total occupied size of the cell in bytes.
   * This includes the size of the `CellOutput` structure plus the size of the `outputData`.
   *
   * @returns The total occupied size in bytes.
   */
  get occupiedSize(): number;
  /**
   * Calculates the free capacity of the cell.
   * Free capacity is the total capacity minus the capacity occupied by the cell's structure and data.
   *
   * @returns The free capacity in shannons as a `Num`.
   */
  get capacityFree(): bigint;
  /**
   * Checks if the cell is a Nervos DAO cell and optionally checks its phase.
   *
   * @param client - A CKB client instance to fetch known script information.
   * @param phase - Optional phase to check: "deposited" or "withdrew".
   *                If omitted, it checks if the cell is a DAO cell regardless of phase.
   * @returns A promise that resolves to `true` if the cell is a matching Nervos DAO cell, `false` otherwise.
   */
  isNervosDao(client: Client, phase?: "deposited" | "withdrew"): Promise<boolean>;
  /**
   * Clones the `CellAny` instance.
   *
   * @returns A new `CellAny` instance that is a deep copy of the current one.
   *
   * @example
   * ```typescript
   * const clonedCell = cellAny.clone();
   * ```
   */
  clone(): CellAny;
}
/**
 * Represents a cell-like object that is guaranteed to be on-chain.
 * It must have an `outPoint` (or its alias `previousOutput`).
 * This is used as a type constraint for creating `Cell` instances.
 * @see Cell
 * @public
 */
type CellLike = CellAnyLike & ({
  outPoint: OutPointLike;
  previousOutput?: undefined | null;
} | {
  outPoint?: undefined | null;
  previousOutput: OutPointLike;
});
/**
 * Represents an on-chain CKB cell, which is a `CellAny` that is guaranteed to have an `outPoint`.
 * This class is typically used for cells that are already part of the blockchain state, such as transaction inputs.
 * @public
 */
declare class Cell extends CellAny {
  outPoint: OutPoint;
  /**
   * Creates an instance of an on-chain Cell.
   *
   * @param outPoint - The output point of the cell.
   * @param cellOutput - The cell output of the cell.
   * @param outputData - The output data of the cell.
   */
  constructor(outPoint: OutPoint, cellOutput: CellOutput, outputData: Hex);
  /**
   * Creates a Cell instance from a CellLike object.
   * This method accepts either `outPoint` or `previousOutput` to specify the cell's location,
   * and supports automatic capacity calculation for the cell output.
   *
   * @param cell - A CellLike object or an instance of Cell. The object can use either:
   *               - `outPoint`: For referencing a cell output
   *               - `previousOutput`: For referencing a cell input (alternative name for outPoint)
   *               The cellOutput can omit capacity for automatic calculation.
   * @returns A Cell instance.
   *
   * @example
   * ```typescript
   * // Using outPoint with explicit capacity
   * const cell1 = Cell.from({
   *   outPoint: { txHash: "0x...", index: 0 },
   *   cellOutput: {
   *     capacity: 1000n,
   *     lock: { codeHash: "0x...", hashType: "type", args: "0x..." }
   *   },
   *   outputData: "0x"
   * });
   *
   * // Using previousOutput with automatic capacity calculation
   * const cell2 = Cell.from({
   *   previousOutput: { txHash: "0x...", index: 0 },
   *   cellOutput: {
   *     lock: { codeHash: "0x...", hashType: "type", args: "0x..." }
   *     // capacity will be calculated automatically
   *   },
   *   outputData: "0x1234"
   * });
   * ```
   */
  static from(cell: CellLike): Cell;
  /**
   * Gets confirmed Nervos DAO profit of a Cell
   * It returns non-zero value only when the cell is in withdrawal phase 2
   * See https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md
   *
   * @param client - A client for searching DAO related headers
   * @returns Profit
   *
   * @example
   * ```typescript
   * const profit = await cell.getDaoProfit(client);
   * ```
   */
  getDaoProfit(client: Client): Promise<Num>;
  /**
   * Retrieves detailed information about a Nervos DAO cell, including its deposit and withdrawal headers.
   *
   * @param client - A CKB client instance to fetch cell and header data.
   * @returns A promise that resolves to an object containing header information.
   *          - If not a DAO cell, returns `{}`.
   *          - If a deposited DAO cell, returns `{ depositHeader }`.
   *          - If a withdrawn DAO cell, returns `{ depositHeader, withdrawHeader }`.
   *
   * @throws If the cell is a DAO cell but its corresponding headers cannot be fetched.
   *
   * @example
   * ```typescript
   * const daoInfo = await cell.getNervosDaoInfo(client);
   * ```
   */
  getNervosDaoInfo(client: Client): Promise<{
    depositHeader?: undefined;
    withdrawHeader?: undefined;
  } | {
    depositHeader: ClientBlockHeader;
    withdrawHeader?: undefined;
  } | {
    depositHeader: ClientBlockHeader;
    withdrawHeader: ClientBlockHeader;
  }>;
  /**
   * Clone a Cell
   *
   * @returns A cloned Cell instance.
   *
   * @example
   * ```typescript
   * const cell1 = cell0.clone();
   * ```
   */
  clone(): Cell;
}
/**
 * @public
 */
type SinceLike = {
  relative: "absolute" | "relative";
  metric: "blockNumber" | "epoch" | "timestamp";
  value: NumLike;
} | NumLike;
declare const Since_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): Since;
  eq(other: SinceLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: SinceLike): Bytes$1;
  decode(_: BytesLike): Since;
  fromBytes(_bytes: BytesLike): Since;
  from(_: SinceLike): Since;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class Since extends Since_base {
  relative: "absolute" | "relative";
  metric: "blockNumber" | "epoch" | "timestamp";
  value: Num;
  /**
   * Creates an instance of Since.
   *
   * @param relative - Absolute or relative
   * @param metric - The metric of since
   * @param value - The value of since
   */
  constructor(relative: "absolute" | "relative", metric: "blockNumber" | "epoch" | "timestamp", value: Num);
  /**
   * Clone a Since.
   *
   * @returns A cloned Since instance.
   *
   * @example
   * ```typescript
   * const since1 = since0.clone();
   * ```
   */
  clone(): Since;
  /**
   * Creates a Since instance from a SinceLike object.
   *
   * @param since - A SinceLike object or an instance of Since.
   * @returns A Since instance.
   *
   * @example
   * ```typescript
   * const since = Since.from("0x1234567812345678");
   * ```
   */
  static from(since: SinceLike): Since;
  /**
   * Converts the Since instance to num.
   *
   * @returns A num
   *
   * @example
   * ```typescript
   * const num = since.toNum();
   * ```
   */
  toNum(): Num;
  /**
   * Creates a Since instance from a num-like value.
   *
   * @param numLike - The num-like value to convert.
   * @returns A Since instance.
   *
   * @example
   * ```typescript
   * const since = Since.fromNum("0x0");
   * ```
   */
  static fromNum(numLike: NumLike): Since;
}
/**
 * @public
 */
type CellInputLike = ({
  previousOutput: OutPointLike;
} | {
  outPoint: OutPointLike;
}) & {
  since?: SinceLike | NumLike | null;
  cellOutput?: CellOutputLike | null;
  outputData?: HexLike | null;
};
declare const CellInput_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): CellInput;
  eq(other: CellInputLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: CellInputLike): Bytes$1;
  decode(_: BytesLike): CellInput;
  fromBytes(_bytes: BytesLike): CellInput;
  from(_: CellInputLike): CellInput;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class CellInput extends CellInput_base {
  previousOutput: OutPoint;
  since: Num;
  cellOutput?: CellOutput | undefined;
  outputData?: Hex | undefined;
  /**
   * Creates an instance of CellInput.
   *
   * @param previousOutput - The previous outpoint of the cell.
   * @param since - The since value of the cell input.
   * @param cellOutput - The optional cell output associated with the cell input.
   * @param outputData - The optional output data associated with the cell input.
   */
  constructor(previousOutput: OutPoint, since: Num, cellOutput?: CellOutput | undefined, outputData?: Hex | undefined);
  /**
   * Creates a CellInput instance from a CellInputLike object.
   *
   * @param cellInput - A CellInputLike object or an instance of CellInput.
   * @returns A CellInput instance.
   *
   * @example
   * ```typescript
   * const cellInput = CellInput.from({
   *   previousOutput: { txHash: "0x...", index: 0 },
   *   since: 0n
   * });
   * ```
   */
  static from(cellInput: CellInputLike): CellInput;
  getCell(client: Client): Promise<Cell>;
  /**
   * Complete extra infos in the input. Including
   * - Previous cell output
   * - Previous cell data
   * The instance will be modified.
   *
   * @returns true if succeed.
   * @example
   * ```typescript
   * await cellInput.completeExtraInfos(client);
   * ```
   */
  completeExtraInfos(client: Client): Promise<void>;
  /**
   * The extra capacity created when consume this input.
   * This is usually NervosDAO interest, see https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md.
   * And it can also be miners' income. (But this is not implemented yet)
   */
  getExtraCapacity(client: Client): Promise<Num>;
  /**
   * Clone a CellInput.
   *
   * @returns A cloned CellInput instance.
   *
   * @example
   * ```typescript
   * const cellInput1 = cellInput0.clone();
   * ```
   */
  clone(): CellInput;
}
declare const CellInputVec: Codec<CellInputLike[], CellInput[]>;
/**
 * @public
 */
type CellDepLike = {
  outPoint: OutPointLike;
  depType: DepTypeLike;
};
declare const CellDep_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): CellDep;
  eq(other: CellDepLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: CellDepLike): Bytes$1;
  decode(_: BytesLike): CellDep;
  fromBytes(_bytes: BytesLike): CellDep;
  from(_: CellDepLike): CellDep;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class CellDep extends CellDep_base {
  outPoint: OutPoint;
  depType: DepType;
  /**
   * Creates an instance of CellDep.
   *
   * @param outPoint - The outpoint of the cell dependency.
   * @param depType - The dependency type.
   */
  constructor(outPoint: OutPoint, depType: DepType);
  /**
   * Creates a CellDep instance from a CellDepLike object.
   *
   * @param cellDep - A CellDepLike object or an instance of CellDep.
   * @returns A CellDep instance.
   *
   * @example
   * ```typescript
   * const cellDep = CellDep.from({
   *   outPoint: { txHash: "0x...", index: 0 },
   *   depType: "depGroup"
   * });
   * ```
   */
  static from(cellDep: CellDepLike): CellDep;
  /**
   * Clone a CellDep.
   *
   * @returns A cloned CellDep instance.
   *
   * @example
   * ```typescript
   * const cellDep1 = cellDep0.clone();
   * ```
   */
  clone(): CellDep;
}
declare const CellDepVec: Codec<CellDepLike[], CellDep[]>;
/**
 * @public
 */
type WitnessArgsLike = {
  lock?: HexLike | null;
  inputType?: HexLike | null;
  outputType?: HexLike | null;
};
declare const WitnessArgs_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): WitnessArgs;
  eq(other: WitnessArgsLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: WitnessArgsLike): Bytes$1;
  decode(_: BytesLike): WitnessArgs;
  fromBytes(_bytes: BytesLike): WitnessArgs;
  from(_: WitnessArgsLike): WitnessArgs;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class WitnessArgs extends WitnessArgs_base {
  lock?: Hex | undefined;
  inputType?: Hex | undefined;
  outputType?: Hex | undefined;
  /**
   * Creates an instance of WitnessArgs.
   *
   * @param lock - The optional lock field of the witness.
   * @param inputType - The optional input type field of the witness.
   * @param outputType - The optional output type field of the witness.
   */
  constructor(lock?: Hex | undefined, inputType?: Hex | undefined, outputType?: Hex | undefined);
  /**
   * Creates a WitnessArgs instance from a WitnessArgsLike object.
   *
   * @param witnessArgs - A WitnessArgsLike object or an instance of WitnessArgs.
   * @returns A WitnessArgs instance.
   *
   * @example
   * ```typescript
   * const witnessArgs = WitnessArgs.from({
   *   lock: "0x...",
   *   inputType: "0x...",
   *   outputType: "0x..."
   * });
   * ```
   */
  static from(witnessArgs: WitnessArgsLike): WitnessArgs;
}
/**
 * Convert a bytes to a num.
 *
 * @public
 */
declare function udtBalanceFrom(dataLike: BytesLike): Num;
declare const RawTransaction: Codec<EncodableRecord<{
  version: Codec<NumLike, number>;
  cellDeps: Codec<CellDepLike[], CellDep[]>;
  headerDeps: Codec<BytesLike[], `0x${string}`[]>;
  inputs: Codec<CellInputLike[], CellInput[]>;
  outputs: Codec<CellOutputLike[], CellOutput[]>;
  outputsData: Codec<BytesLike[], `0x${string}`[]>;
}>, DecodedRecord<{
  version: Codec<NumLike, number>;
  cellDeps: Codec<CellDepLike[], CellDep[]>;
  headerDeps: Codec<BytesLike[], `0x${string}`[]>;
  inputs: Codec<CellInputLike[], CellInput[]>;
  outputs: Codec<CellOutputLike[], CellOutput[]>;
  outputsData: Codec<BytesLike[], `0x${string}`[]>;
}>>;
/**
 * @public
 */
type TransactionLike = {
  version?: NumLike | null;
  cellDeps?: CellDepLike[] | null;
  headerDeps?: HexLike[] | null;
  inputs?: CellInputLike[] | null;
  outputs?: (Omit<CellOutputLike, "capacity"> & Partial<Pick<CellOutputLike, "capacity">>)[] | null;
  outputsData?: HexLike[] | null;
  witnesses?: HexLike[] | null;
};
declare const Transaction_base: (abstract new () => {
  toBytes(): Bytes$1;
  clone(): Transaction;
  eq(other: TransactionLike): boolean;
  hash(): Hex;
  toHex(): Hex;
}) & {
  byteLength?: number;
  encode(_: TransactionLike): Bytes$1;
  decode(_: BytesLike): Transaction;
  fromBytes(_bytes: BytesLike): Transaction;
  from(_: TransactionLike): Transaction;
  Base<SubTypeLike, SubType = SubTypeLike>(): (abstract new () => {
    toBytes(): Bytes$1;
    clone(): SubType;
    eq(other: SubTypeLike): boolean;
    hash(): Hex;
    toHex(): Hex;
  }) & {
    byteLength?: number;
    encode(_: SubTypeLike): Bytes$1;
    decode(_: BytesLike): SubType;
    fromBytes(_bytes: BytesLike): SubType;
    from(_: SubTypeLike): SubType;
    Base<SubTypeLike, SubType = SubTypeLike>(): /*elided*/any;
  };
};
/**
 * @public
 */
declare class Transaction extends Transaction_base {
  version: Num;
  cellDeps: CellDep[];
  headerDeps: Hex[];
  inputs: CellInput[];
  outputs: CellOutput[];
  outputsData: Hex[];
  witnesses: Hex[];
  /**
   * Creates an instance of Transaction.
   *
   * @param version - The version of the transaction.
   * @param cellDeps - The cell dependencies of the transaction.
   * @param headerDeps - The header dependencies of the transaction.
   * @param inputs - The inputs of the transaction.
   * @param outputs - The outputs of the transaction.
   * @param outputsData - The data associated with the outputs.
   * @param witnesses - The witnesses of the transaction.
   */
  constructor(version: Num, cellDeps: CellDep[], headerDeps: Hex[], inputs: CellInput[], outputs: CellOutput[], outputsData: Hex[], witnesses: Hex[]);
  /**
   * Creates a default Transaction instance with empty fields.
   *
   * @returns A default Transaction instance.
   *
   * @example
   * ```typescript
   * const defaultTx = Transaction.default();
   * ```
   */
  static default(): Transaction;
  /**
   * Copy every properties from another transaction.
   * This method replaces all properties of the current transaction with those from the provided transaction.
   *
   * @param txLike - The transaction-like object to copy properties from.
   *
   * @example
   * ```typescript
   * this.copy(Transaction.default());
   * ```
   */
  copy(txLike: TransactionLike): void;
  /**
   * Creates a deep copy of the transaction.
   * This method creates a new Transaction instance with all nested objects cloned,
   * ensuring that modifications to the cloned transaction do not affect the original.
   *
   * @returns A new Transaction instance that is a deep copy of the current transaction.
   *
   * @example
   * ```typescript
   * const originalTx = Transaction.from({
   *   version: 0,
   *   inputs: [{ previousOutput: { txHash: "0x...", index: 0 } }],
   *   outputs: [{ capacity: 1000n, lock: lockScript }],
   *   outputsData: ["0x"],
   *   witnesses: ["0x"]
   * });
   *
   * const clonedTx = originalTx.clone();
   *
   * // Modifications to clonedTx won't affect originalTx
   * clonedTx.addOutput({ capacity: 2000n, lock: anotherLockScript });
   * console.log(originalTx.outputs.length); // Still 1
   * console.log(clonedTx.outputs.length);   // Now 2
   * ```
   *
   * @remarks
   * The clone operation performs deep copying for:
   * - Cell dependencies (cellDeps) - each CellDep is cloned
   * - Inputs - each CellInput is cloned
   * - Outputs - each CellOutput is cloned
   *
   * The following are shallow copied (references to immutable data):
   * - Header dependencies (headerDeps) - Hex strings are immutable
   * - Output data (outputsData) - Hex strings are immutable
   * - Witnesses - Hex strings are immutable
   * - Version - bigint is immutable
   */
  clone(): Transaction;
  /**
   * Creates a Transaction instance from a TransactionLike object.
   *
   * @param tx - A TransactionLike object or an instance of Transaction.
   * @returns A Transaction instance.
   *
   * @example
   * ```typescript
   * const transaction = Transaction.from({
   *   version: 0,
   *   cellDeps: [],
   *   headerDeps: [],
   *   inputs: [],
   *   outputs: [],
   *   outputsData: [],
   *   witnesses: []
   * });
   * ```
   */
  static from(tx: TransactionLike): Transaction;
  /**
   * Creates a Transaction instance from a Lumos skeleton.
   *
   * @param skeleton - The Lumos transaction skeleton.
   * @returns A Transaction instance.
   *
   * @throws Will throw an error if an input's outPoint is missing.
   *
   * @example
   * ```typescript
   * const transaction = Transaction.fromLumosSkeleton(skeleton);
   * ```
   */
  static fromLumosSkeleton(skeleton: LumosTransactionSkeletonType): Transaction;
  /**
   * @deprecated
   * Use ccc.stringify instead.
   * stringify the tx to JSON string.
   */
  stringify(): string;
  /**
   * Converts the raw transaction data to bytes.
   *
   * @returns A Uint8Array containing the raw transaction bytes.
   *
   * @example
   * ```typescript
   * const rawTxBytes = transaction.rawToBytes();
   * ```
   */
  rawToBytes(): Bytes$1;
  /**
   * Calculates the hash of the transaction without witnesses. This is the transaction hash in the usual sense.
   * To calculate the hash of the whole transaction including the witnesses, use transaction.hashFull() instead.
   *
   * @returns The hash of the transaction.
   *
   * @example
   * ```typescript
   * const txHash = transaction.hash();
   * ```
   */
  hash(): Hex;
  /**
   * Calculates the hash of the transaction with witnesses.
   *
   * @returns The hash of the transaction with witnesses.
   *
   * @example
   * ```typescript
   * const txFullHash = transaction.hashFull();
   * ```
   */
  hashFull(): Hex;
  /**
   * Hashes a witness and updates the hasher.
   *
   * @param witness - The witness to hash.
   * @param hasher - The hasher instance to update.
   *
   * @example
   * ```typescript
   * Transaction.hashWitnessToHasher("0x...", hasher);
   * ```
   */
  static hashWitnessToHasher(witness: HexLike, hasher: Hasher): void;
  /**
   * Computes the signing hash information for a given script.
   *
   * @param scriptLike - The script associated with the transaction, represented as a ScriptLike object.
   * @param client - The client for complete extra infos in the transaction.
   * @returns A promise that resolves to an object containing the signing message and the witness position,
   *          or undefined if no matching input is found.
   *
   * @example
   * ```typescript
   * const signHashInfo = await tx.getSignHashInfo(scriptLike, client);
   * if (signHashInfo) {
   *   console.log(signHashInfo.message); // Outputs the signing message
   *   console.log(signHashInfo.position); // Outputs the witness position
   * }
   * ```
   */
  getSignHashInfo(scriptLike: ScriptLike, client: Client, hasher?: Hasher): Promise<{
    message: Hex;
    position: number;
  } | undefined>;
  /**
   * Find the first occurrence of a input with the specified lock id
   *
   * @param scriptIdLike - The script associated with the transaction, represented as a ScriptLike object without args.
   * @param client - The client for complete extra infos in the transaction.
   * @returns A promise that resolves to the found index
   *
   * @example
   * ```typescript
   * const index = await tx.findInputIndexByLockId(scriptIdLike, client);
   * ```
   */
  findInputIndexByLockId(scriptIdLike: Pick<ScriptLike, "codeHash" | "hashType">, client: Client): Promise<number | undefined>;
  /**
   * Find the first occurrence of a input with the specified lock
   *
   * @param scriptLike - The script associated with the transaction, represented as a ScriptLike object.
   * @param client - The client for complete extra infos in the transaction.
   * @returns A promise that resolves to the found index, or undefined if no matching input is found.
   *
   * @example
   * ```typescript
   * const index = await tx.findInputIndexByLock(scriptLike, client);
   * ```
   */
  findInputIndexByLock(scriptLike: ScriptLike, client: Client): Promise<number | undefined>;
  /**
   * Find the last occurrence of a input with the specified lock
   *
   * @param scriptLike - The script associated with the transaction, represented as a ScriptLike object.
   * @param client - The client for complete extra infos in the transaction.
   * @returns A promise that resolves to the found index, or undefined if no matching input is found.
   *
   * @example
   * ```typescript
   * const index = await tx.findLastInputIndexByLock(scriptLike, client);
   * ```
   */
  findLastInputIndexByLock(scriptLike: ScriptLike, client: Client): Promise<number | undefined>;
  /**
   * Add cell deps if they are not existed
   *
   * @param cellDepLikes - The cell deps to add
   *
   * @example
   * ```typescript
   * tx.addCellDeps(cellDep);
   * ```
   */
  addCellDeps(...cellDepLikes: (CellDepLike | CellDepLike[])[]): void;
  /**
   * Add cell deps at the start if they are not existed
   *
   * @param cellDepLikes - The cell deps to add
   *
   * @example
   * ```typescript
   * tx.addCellDepsAtBegin(cellDep);
   * ```
   */
  addCellDepsAtStart(...cellDepLikes: (CellDepLike | CellDepLike[])[]): void;
  /**
   * Add cell dep from infos if they are not existed
   *
   * @param client - A client for searching cell deps
   * @param cellDepInfoLikes - The cell dep infos to add
   *
   * @example
   * ```typescript
   * tx.addCellDepInfos(client, cellDepInfos);
   * ```
   */
  addCellDepInfos(client: Client, ...cellDepInfoLikes: (CellDepInfoLike | CellDepInfoLike[])[]): Promise<void>;
  /**
   * Add cell deps from known script
   *
   * @param client - The client for searching known script and cell deps
   * @param scripts - The known scripts to add
   *
   * @example
   * ```typescript
   * tx.addCellDepsOfKnownScripts(client, KnownScript.OmniLock);
   * ```
   */
  addCellDepsOfKnownScripts(client: Client, ...scripts: (KnownScript | KnownScript[])[]): Promise<void>;
  /**
   * Set output data at index.
   *
   * @param index - The index of the output data.
   * @param data - The data to set.
   *
   * @example
   * ```typescript
   * tx.setOutputDataAt(0, "0x00");
   * ```
   */
  setOutputDataAt(index: number, data: HexLike): void;
  /**
   * get input
   *
   * @param index - The cell input index
   *
   * @example
   * ```typescript
   * await tx.getInput(0);
   * ```
   */
  getInput(index: NumLike): CellInput | undefined;
  /**
   * add input
   *
   * @param inputLike - The cell input.
   *
   * @example
   * ```typescript
   * await tx.addInput({ });
   * ```
   */
  addInput(inputLike: CellInputLike): number;
  /**
   * get output
   *
   * @param index - The cell output index
   *
   * @example
   * ```typescript
   * await tx.getOutput(0);
   * ```
   */
  getOutput(index: NumLike): CellAny | undefined;
  /**
   * Provides an iterable over the transaction's output cells.
   *
   * This getter is a convenient way to iterate through all the output cells (`CellAny`)
   * of the transaction, combining the `outputs` and `outputsData` arrays.
   * It can be used with `for...of` loops or other iterable-consuming patterns.
   *
   * @public
   * @category Getter
   * @returns An `Iterable<CellAny>` that yields each output cell of the transaction.
   *
   * @example
   * ```typescript
   * for (const cell of tx.outputCells) {
   *   console.log(`Output cell capacity: ${cell.cellOutput.capacity}`);
   * }
   * ```
   */
  get outputCells(): Iterable<CellAny>;
  /**
   * Adds an output to the transaction.
   *
   * This method supports two overloads for adding an output:
   * 1. By providing a `CellAnyLike` object, which encapsulates both `cellOutput` and `outputData`.
   * 2. By providing a `CellOutputLike` object and an optional `outputData`.
   *
   * @param cellOrOutputLike - A cell-like object containing both cell output and data, or just the cell output object.
   * @param outputDataLike - Optional data for the cell output. Defaults to "0x" if not provided in the first argument.
   * @returns The new number of outputs in the transaction.
   *
   * @example
   * ```typescript
   * // 1. Add an output using a CellAnyLike object
   * const newLength1 = tx.addOutput({
   *   cellOutput: { lock: recipientLock }, // capacity is calculated automatically
   *   outputData: "0x1234",
   * });
   *
   * // 2. Add an output using CellOutputLike and data separately
   * const newLength2 = tx.addOutput({ lock: recipientLock }, "0xabcd");
   * ```
   */
  addOutput(cellLike: CellAnyLike): number;
  addOutput(outputLike: CellOutputLike, outputDataLike?: HexLike | null): number;
  /**
   * Get witness at index as WitnessArgs
   *
   * @param index - The index of the witness.
   * @returns The witness parsed as WitnessArgs.
   *
   * @example
   * ```typescript
   * const witnessArgs = tx.getWitnessArgsAt(0);
   * ```
   */
  getWitnessArgsAt(index: number): WitnessArgs | undefined;
  /**
   * Get witness at index as WitnessArgs, throw if failed to decode
   *
   * @param index - The index of the witness.
   * @returns The witness parsed as WitnessArgs.
   *
   * @example
   * ```typescript
   * const witnessArgs = tx.getWitnessArgsAtUnsafe(0);
   * ```
   */
  getWitnessArgsAtUnsafe(index: number): WitnessArgs | undefined;
  /**
   * Set witness at index by WitnessArgs
   *
   * @param index - The index of the witness.
   * @param witness - The WitnessArgs to set.
   *
   * @example
   * ```typescript
   * await tx.setWitnessArgsAt(0, witnessArgs);
   * ```
   */
  setWitnessArgsAt(index: number, witness: WitnessArgs): void;
  /**
   * Set witness at index
   *
   * @param index - The index of the witness.
   * @param witness - The witness to set.
   *
   * @example
   * ```typescript
   * await tx.setWitnessAt(0, witness);
   * ```
   */
  setWitnessAt(index: number, witness: HexLike): void;
  /**
   * Prepare dummy witness for sighash all method
   *
   * @param scriptLike - The script associated with the transaction, represented as a ScriptLike object.
   * @param lockLen - The length of dummy lock bytes.
   * @param client - The client for complete extra infos in the transaction.
   * @returns A promise that resolves to the prepared transaction
   *
   * @example
   * ```typescript
   * await tx.prepareSighashAllWitness(scriptLike, 85, client);
   * ```
   */
  prepareSighashAllWitness(scriptLike: ScriptLike, lockLen: number, client: Client): Promise<void>;
  getInputsCapacityExtra(client: Client): Promise<Num>;
  getInputsCapacity(client: Client): Promise<Num>;
  getOutputsCapacity(): Num;
  getInputsUdtBalance(client: Client, type: ScriptLike): Promise<Num>;
  getOutputsUdtBalance(type: ScriptLike): Num;
  completeInputs<T>(from: Signer, filter: ClientCollectableSearchKeyFilterLike, accumulator: (acc: T, v: Cell, i: number, array: Cell[]) => Promise<T | undefined> | T | undefined, init: T): Promise<{
    addedCount: number;
    accumulated?: T;
  }>;
  completeInputsByCapacity(from: Signer, capacityTweak?: NumLike, filter?: ClientCollectableSearchKeyFilterLike): Promise<number>;
  completeInputsAll(from: Signer, filter?: ClientCollectableSearchKeyFilterLike): Promise<number>;
  /**
   * Complete inputs by UDT balance
   *
   * This method succeeds only if enough balance is collected.
   *
   * It will try to collect at least two inputs, even when the first input already contains enough balance, to avoid extra occupation fees introduced by the change cell. An edge case: If the first cell has the same amount as the output, a new cell is not needed.
   * @param from - The signer to complete the inputs.
   * @param type - The type script of the UDT.
   * @param balanceTweak - The tweak of the balance.
   * @returns A promise that resolves to the number of inputs added.
   */
  completeInputsByUdt(from: Signer, type: ScriptLike, balanceTweak?: NumLike): Promise<number>;
  completeInputsAddOne(from: Signer, filter?: ClientCollectableSearchKeyFilterLike): Promise<number>;
  completeInputsAtLeastOne(from: Signer, filter?: ClientCollectableSearchKeyFilterLike): Promise<number>;
  getFee(client: Client): Promise<Num>;
  getFeeRate(client: Client): Promise<Num>;
  estimateFee(feeRate: NumLike): Num;
  /**
   * Completes the transaction fee by adding inputs and handling change outputs.
   * This method automatically calculates the required fee based on the transaction size and fee rate,
   * adds necessary inputs to cover the fee, and handles change outputs through the provided change function.
   *
   * @param from - The signer to complete inputs from and prepare the transaction.
   * @param change - A function that handles change capacity. It receives the transaction and excess capacity,
   *                 and should return the additional capacity needed (0 if change is handled successfully,
   *                 positive number if more capacity is needed for change cell creation).
   * @param expectedFeeRate - The expected fee rate in shannons per 1000 bytes. If not provided,
   *                          it will be fetched from the client.
   * @param filter - Optional filter for selecting cells when adding inputs.
   * @param options - Optional configuration object.
   * @param options.feeRateBlockRange - Block range for fee rate calculation when expectedFeeRate is not provided.
   * @param options.maxFeeRate - Maximum allowed fee rate.
   * @param options.shouldAddInputs - Whether to add inputs automatically. Defaults to true.
   * @returns A promise that resolves to a tuple containing:
   *          - The number of inputs added during the process
   *          - A boolean indicating whether change outputs were created (true) or fee was paid without change (false)
   *
   * @throws {ErrorTransactionInsufficientCapacity} When there's not enough capacity to cover the fee.
   * @throws {Error} When the change function doesn't properly handle the available capacity.
   *
   * @example
   * ```typescript
   * const [addedInputs, hasChange] = await tx.completeFee(
   *   signer,
   *   (tx, capacity) => {
   *     if (capacity >= 61_00000000n) { // Minimum for a change cell
   *       tx.addOutput({ capacity, lock: changeScript });
   *       return 0;
   *     }
   *     return 61_00000000n; // Need more capacity for change cell
   *   },
   *   1000n // 1000 shannons per 1000 bytes
   * );
   * ```
   */
  completeFee(from: Signer, change: (tx: Transaction, capacity: Num) => Promise<NumLike> | NumLike, expectedFeeRate?: NumLike, filter?: ClientCollectableSearchKeyFilterLike, options?: {
    feeRateBlockRange?: NumLike;
    maxFeeRate?: NumLike;
    shouldAddInputs?: boolean;
  }): Promise<[number, boolean]>;
  /**
   * Completes the transaction fee by adding inputs and creating a change output with the specified lock script.
   * This is a convenience method that automatically creates a change cell with the provided lock script
   * when there's excess capacity after paying the transaction fee.
   *
   * @param from - The signer to complete inputs from and prepare the transaction.
   * @param change - The lock script for the change output cell.
   * @param feeRate - Optional fee rate in shannons per 1000 bytes. If not provided, it will be fetched from the client.
   * @param filter - Optional filter for selecting cells when adding inputs.
   * @param options - Optional configuration object.
   * @param options.feeRateBlockRange - Block range for fee rate calculation when feeRate is not provided.
   * @param options.maxFeeRate - Maximum allowed fee rate.
   * @param options.shouldAddInputs - Whether to add inputs automatically. Defaults to true.
   * @returns A promise that resolves to a tuple containing:
   *          - The number of inputs added during the process
   *          - A boolean indicating whether change outputs were created (true) or fee was paid without change (false)
   *
   * @example
   * ```typescript
   * const changeScript = Script.from({
   *   codeHash: "0x...",
   *   hashType: "type",
   *   args: "0x..."
   * });
   *
   * const [addedInputs, hasChange] = await tx.completeFeeChangeToLock(
   *   signer,
   *   changeScript,
   *   1000n // 1000 shannons per 1000 bytes
   * );
   * ```
   */
  completeFeeChangeToLock(from: Signer, change: ScriptLike, feeRate?: NumLike, filter?: ClientCollectableSearchKeyFilterLike, options?: {
    feeRateBlockRange?: NumLike;
    maxFeeRate?: NumLike;
    shouldAddInputs?: boolean;
  }): Promise<[number, boolean]>;
  /**
   * Completes the transaction fee using the signer's recommended address for change.
   * This is a convenience method that automatically uses the signer's recommended
   * address as the change destination, making it easier to complete transactions
   * without manually specifying a change address.
   *
   * @param from - The signer to complete inputs from and prepare the transaction.
   * @param feeRate - Optional fee rate in shannons per 1000 bytes. If not provided, it will be fetched from the client.
   * @param filter - Optional filter for selecting cells when adding inputs.
   * @param options - Optional configuration object.
   * @param options.feeRateBlockRange - Block range for fee rate calculation when feeRate is not provided.
   * @param options.maxFeeRate - Maximum allowed fee rate.
   * @param options.shouldAddInputs - Whether to add inputs automatically. Defaults to true.
   * @returns A promise that resolves to a tuple containing:
   *          - The number of inputs added during the process
   *          - A boolean indicating whether change outputs were created (true) or fee was paid without change (false)
   *
   * @example
   * ```typescript
   * const [addedInputs, hasChange] = await tx.completeFeeBy(
   *   signer,
   *   1000n // 1000 shannons per 1000 bytes
   * );
   *
   * // Change will automatically go to signer's recommended address
   * ```
   */
  completeFeeBy(from: Signer, feeRate?: NumLike, filter?: ClientCollectableSearchKeyFilterLike, options?: {
    feeRateBlockRange?: NumLike;
    maxFeeRate?: NumLike;
    shouldAddInputs?: boolean;
  }): Promise<[number, boolean]>;
  /**
   * Completes the transaction fee by adding excess capacity to an existing output.
   * Instead of creating a new change output, this method adds any excess capacity
   * to the specified existing output in the transaction.
   *
   * @param from - The signer to complete inputs from and prepare the transaction.
   * @param index - The index of the existing output to add excess capacity to.
   * @param feeRate - Optional fee rate in shannons per 1000 bytes. If not provided, it will be fetched from the client.
   * @param filter - Optional filter for selecting cells when adding inputs.
   * @param options - Optional configuration object.
   * @param options.feeRateBlockRange - Block range for fee rate calculation when feeRate is not provided.
   * @param options.maxFeeRate - Maximum allowed fee rate.
   * @param options.shouldAddInputs - Whether to add inputs automatically. Defaults to true.
   * @returns A promise that resolves to a tuple containing:
   *          - The number of inputs added during the process
   *          - A boolean indicating whether change was applied (true) or fee was paid without change (false)
   *
   * @throws {Error} When the specified output index doesn't exist.
   *
   * @example
   * ```typescript
   * // Add excess capacity to the first output (index 0)
   * const [addedInputs, hasChange] = await tx.completeFeeChangeToOutput(
   *   signer,
   *   0, // Output index
   *   1000n // 1000 shannons per 1000 bytes
   * );
   * ```
   */
  completeFeeChangeToOutput(from: Signer, index: NumLike, feeRate?: NumLike, filter?: ClientCollectableSearchKeyFilterLike, options?: {
    feeRateBlockRange?: NumLike;
    maxFeeRate?: NumLike;
    shouldAddInputs?: boolean;
  }): Promise<[number, boolean]>;
}
/**
 * Checks whether a NervosDAO transaction exceeds the 64-output limit.
 * Returns true if the transaction is DAO-related and has more than 64 outputs.
 * Short-circuits to false when outputs <= 64.
 *
 * @param tx - The transaction to check
 * @param client - CKB client for resolving the NervosDAO script and input cell info
 * @returns true if the DAO output limit is exceeded
 */
declare function isDaoOutputLimitExceeded(tx: Transaction, client: Client): Promise<boolean>;
/**
 * Calculate Nervos DAO profit between two blocks.
 * This function computes the profit earned from a Nervos DAO deposit
 * based on the capacity and the time period between deposit and withdrawal.
 *
 * @param profitableCapacity - The capacity that earns profit (total capacity minus occupied capacity).
 * @param depositHeaderLike - The block header when the DAO deposit was made.
 * @param withdrawHeaderLike - The block header when the DAO withdrawal is made.
 * @returns The profit amount in CKB (capacity units).
 *
 * @example
 * ```typescript
 * const profit = calcDaoProfit(
 *   ccc.fixedPointFrom(100), // 100 CKB profitable capacity
 *   depositHeader,
 *   withdrawHeader
 * );
 * console.log(`Profit: ${profit} shannons`);
 * ```
 *
 * @see {@link https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md | Nervos DAO RFC}
 */
declare function calcDaoProfit(profitableCapacity: NumLike, depositHeaderLike: ClientBlockHeaderLike, withdrawHeaderLike: ClientBlockHeaderLike): Num;
/**
 * Calculate claimable epoch for Nervos DAO withdrawal.
 * This function determines the earliest epoch when a Nervos DAO withdrawal
 * can be claimed based on the deposit and withdrawal epochs.
 *
 * @param depositHeader - The block header when the DAO deposit was made.
 * @param withdrawHeader - The block header when the DAO withdrawal was initiated.
 * @returns The epoch when the withdrawal can be claimed, represented as an Epoch instance.
 *
 * @example
 * ```typescript
 * const epoch = calcDaoClaimEpoch(depositHeader, withdrawHeader);
 * console.log(`Can claim at epoch: ${epoch.integer}, numerator: ${epoch.numerator}, denominator: ${epoch.denominator}`);
 * ```
 *
 * @remarks
 * The Nervos DAO has a minimum lock period of 180 epochs (~30 days).
 * This function calculates the exact epoch when the withdrawal becomes claimable
 * based on the deposit epoch and withdrawal epoch timing.
 *
 * @see {@link https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md | Nervos DAO RFC}
 */
declare function calcDaoClaimEpoch(depositHeader: ClientBlockHeaderLike, withdrawHeader: ClientBlockHeaderLike): Epoch;
//#endregion
//#region src/ckb/hash.d.ts
/**
 * Computes the Type ID hash of the given data.
 * @public
 *
 * @param cellInputLike - The first cell input of the transaction.
 * @param outputIndex - The output index of the Type ID cell.
 * @returns The hexadecimal string representation of the hash.
 *
 * @example
 * ```typescript
 * const hash = hashTypeId(cellInput, outputIndex); // Outputs something like "0x..."
 * ```
 */
declare function hashTypeId(cellInputLike: CellInputLike, outputIndex: NumLike): Hex;
//#endregion
//#region src/ckb/transactionErrors.d.ts
declare class ErrorTransactionInsufficientCapacity extends Error {
  readonly amount: Num;
  readonly isForChange: boolean;
  constructor(amountLike: NumLike, reason?: {
    isForChange?: boolean;
  });
}
declare class ErrorTransactionInsufficientCoin extends Error {
  readonly amount: Num;
  readonly type: Script;
  constructor(amountLike: NumLike, typeLike: ScriptLike);
}
//#endregion
//#region src/client/cache/cache.d.ts
/**
 * @public
 * The ClientCache class is mainly designed for chained transactions.
 * Consumed & Created cells are "marked" so they can be correctly handled when composing transactions.
 * It also act as cache for rpc requests to reduce cost, but this is optional.
 */
declare abstract class ClientCache {
  abstract markUsableNoCache(...cellLikes: (CellLike | CellLike[])[]): Promise<void>;
  markUsable(...cellLikes: (CellLike | CellLike[])[]): Promise<void>;
  abstract markUnusable(...outPointLike: (OutPointLike | OutPointLike[])[]): Promise<void>;
  markTransactions(...transactionLike: (TransactionLike | TransactionLike[])[]): Promise<void>;
  abstract clear(): Promise<void>;
  abstract findCells(filter: ClientCollectableSearchKeyLike): AsyncGenerator<Cell>;
  abstract isUnusable(outPointLike: OutPointLike): Promise<boolean>;
  /**
   * Record known cells
   * Implement this method to enable cells query caching
   * @param _cells
   */
  recordCells(..._cells: (CellLike | CellLike[])[]): Promise<void>;
  /**
   * Get a known cell by out point
   * Implement this method to enable cells query caching
   * @param _outPoint
   */
  getCell(_outPoint: OutPointLike): Promise<Cell | undefined>;
  /**
   * Record known transaction responses.
   * Implement this method to enable transactions query caching
   * @param _transactions
   */
  recordTransactionResponses(..._transactions: (ClientTransactionResponseLike | ClientTransactionResponseLike[])[]): Promise<void>;
  /**
   * Get a known transaction response by hash
   * Implement this method to enable transactions query caching
   * @param _txHash
   */
  getTransactionResponse(_txHash: HexLike): Promise<ClientTransactionResponse | undefined>;
  /**
   * Record known transactions.
   * @param transactions
   */
  recordTransactions(...transactions: (TransactionLike | TransactionLike[])[]): Promise<void>;
  /**
   * Get a known transaction by hash
   * @param txHash
   */
  getTransaction(txHash: HexLike): Promise<Transaction | undefined>;
  /**
   * Record known block headers.
   * Implement this method to enable block headers query caching
   * @param _headers
   */
  recordHeaders(..._headers: (ClientBlockHeaderLike | ClientBlockHeaderLike[])[]): Promise<void>;
  /**
   * Get a known block header by hash
   * Implement this method to enable block headers query caching
   * @param _hash
   */
  getHeaderByHash(_hash: HexLike): Promise<ClientBlockHeader | undefined>;
  /**
   * Get a known block header by number
   * Implement this method to enable block headers query caching
   * @param _number
   */
  getHeaderByNumber(_number: NumLike): Promise<ClientBlockHeader | undefined>;
  /**
   * Record known blocks.
   * Implement this method to enable blocks query caching
   * @param _blocks
   */
  recordBlocks(..._blocks: (ClientBlockLike | ClientBlockLike[])[]): Promise<void>;
  /**
   * Get a known block header by hash
   * Implement this method to enable block headers query caching
   * @param _hash
   */
  getBlockByHash(_hash: HexLike): Promise<ClientBlock | undefined>;
  /**
   * Get a known block header by number
   * Implement this method to enable block headers query caching
   * @param _number
   */
  getBlockByNumber(_number: NumLike): Promise<ClientBlock | undefined>;
  /**
   * Checks if a block header is considered confirmed.
   * The default implementation compares the header's timestamp against the current time
   * and a configured confirmation time. Override this method for custom confirmation logic.
   * @param header
   */
  hasHeaderConfirmed(header: ClientBlockHeader): boolean;
}
//#endregion
//#region src/client/cache/memory.d.ts
declare class ClientCacheMemory extends ClientCache {
  private readonly maxCells;
  private readonly maxTxs;
  private readonly maxBlocks;
  /**
   * OutPoint => [isLive, Cell | OutPoint]
   */
  private readonly cells;
  /**
   * TX Hash => Transaction Response
   */
  private readonly knownTransactions;
  /**
   * Block Number => Block Hash
   */
  private readonly knownBlockHashes;
  /**
   * Block Hash => Block Header / Full Block
   */
  private readonly knownBlocks;
  private readonly confirmedBlockTime;
  /**
   * @param maxCells - Maximum number of cells to store in the cache. Defaults to 512.
   * @param maxTxs - Maximum number of transactions to store in the cache. Defaults to 256.
   * @param maxBlocks - Maximum number of blocks to store in the cache. Defaults to 128.
   * @param confirmedBlockTimeLike - Time in milliseconds after which a block is considered confirmed.
   *                                 Defaults to DEFAULT_CONFIRMED_BLOCK_TIME (50 blocks * 10s).
   */
  constructor(maxCells?: number, maxTxs?: number, maxBlocks?: number, confirmedBlockTimeLike?: NumLike);
  markUsableNoCache(...cellLikes: (CellLike | CellLike[])[]): Promise<void>;
  markUnusable(...outPointLikes: (OutPointLike | OutPointLike[])[]): Promise<void>;
  clear(): Promise<void>;
  findCells(keyLike: ClientCollectableSearchKeyLike): AsyncGenerator<Cell>;
  isUnusable(outPointLike: OutPointLike): Promise<boolean>;
  recordCells(...cells: (CellLike | CellLike[])[]): Promise<void>;
  getCell(outPointLike: OutPointLike): Promise<Cell | undefined>;
  recordTransactionResponses(...transactions: (ClientTransactionResponseLike | ClientTransactionResponseLike[])[]): Promise<void>;
  getTransactionResponse(txHashLike: HexLike): Promise<ClientTransactionResponse | undefined>;
  recordHeaders(...headers: (ClientBlockHeaderLike | ClientBlockHeaderLike[])[]): Promise<void>;
  getHeaderByHash(hashLike: HexLike): Promise<ClientBlockHeader | undefined>;
  getHeaderByNumber(numberLike: NumLike): Promise<ClientBlockHeader | undefined>;
  recordBlocks(...blocks: (ClientBlockLike | ClientBlockLike[])[]): Promise<void>;
  getBlockByHash(hashLike: HexLike): Promise<ClientBlock | undefined>;
  getBlockByNumber(numberLike: NumLike): Promise<ClientBlock | undefined>;
  hasHeaderConfirmed(header: ClientBlockHeader): boolean;
}
//#endregion
//#region src/client/client.d.ts
/**
 * @public
 */
declare abstract class Client {
  cache: ClientCache;
  constructor(config?: {
    cache?: ClientCache;
  });
  abstract get url(): string;
  abstract get addressPrefix(): string;
  /**
   * Get the deployment info for a well-known CKB script.
   * Returns the cell deps and type script info needed to use the script.
   *
   * @param script - The KnownScript enum value.
   * @returns Script info including cellDeps and type hash.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   *
   * // Get xUDT script deployment info
   * const xudtInfo = await client.getKnownScript(ccc.KnownScript.XUdt);
   * console.log(`xUDT cellDeps:`, xudtInfo.cellDeps);
   *
   * // Build an xUDT type script
   * const xudtType = await ccc.Script.fromKnownScript(
   *   client,
   *   ccc.KnownScript.XUdt,
   *   "0xOWNER_LOCK_HASH...",
   * );
   * ```
   */
  abstract getKnownScript(script: KnownScript): Promise<ScriptInfo>;
  abstract getFeeRateStatistics(blockRange?: NumLike): Promise<{
    mean: Num;
    median: Num;
  }>;
  /**
   * Get the recommended transaction fee rate based on recent blocks.
   * Returns the median fee rate, clamped between min and max fee rates.
   *
   * @param blockRange - Number of recent blocks to analyze.
   * @param options - Optional max fee rate cap.
   * @returns The recommended fee rate in Shannons per KB.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const feeRate = await client.getFeeRate();
   * console.log(`Current fee rate: ${feeRate} Shannons/KB`);
   * ```
   */
  getFeeRate(blockRange?: NumLike, options?: {
    maxFeeRate?: NumLike;
  }): Promise<Num>;
  /**
   * Get the latest block number (tip) of the chain.
   *
   * @returns The current tip block number.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const tipBlockNumber = await client.getTip();
   * console.log(`Current block height: ${tipBlockNumber}`);
   * ```
   */
  abstract getTip(): Promise<Num>;
  /**
   * Get the header of the latest block.
   *
   * @param verbosity - Verbosity level (0 for hex, 1 for object).
   * @returns The tip block header.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const header = await client.getTipHeader();
   * console.log(`Block #${header.number}, hash: ${header.hash}`);
   * ```
   */
  abstract getTipHeader(verbosity?: number | null): Promise<ClientBlockHeader>;
  abstract getBlockByNumberNoCache(blockNumber: NumLike, verbosity?: number | null, withCycles?: boolean | null): Promise<ClientBlock | undefined>;
  abstract getBlockByHashNoCache(blockHash: HexLike, verbosity?: number | null, withCycles?: boolean | null): Promise<ClientBlock | undefined>;
  abstract getHeaderByNumberNoCache(blockNumber: NumLike, verbosity?: number | null): Promise<ClientBlockHeader | undefined>;
  abstract getHeaderByHashNoCache(blockHash: HexLike, verbosity?: number | null): Promise<ClientBlockHeader | undefined>;
  getBlockByNumber(blockNumber: NumLike, verbosity?: number | null, withCycles?: boolean | null): Promise<ClientBlock | undefined>;
  getBlockByHash(blockHash: HexLike, verbosity?: number | null, withCycles?: boolean | null): Promise<ClientBlock | undefined>;
  getHeaderByNumber(blockNumber: NumLike, verbosity?: number | null): Promise<ClientBlockHeader | undefined>;
  getHeaderByHash(blockHash: HexLike, verbosity?: number | null): Promise<ClientBlockHeader | undefined>;
  abstract estimateCycles(transaction: TransactionLike): Promise<Num>;
  abstract sendTransactionDry(transaction: TransactionLike, validator?: OutputsValidator): Promise<Num>;
  abstract sendTransactionNoCache(transaction: TransactionLike, validator?: OutputsValidator): Promise<Hex>;
  abstract getTransactionNoCache(txHash: HexLike): Promise<ClientTransactionResponse | undefined>;
  /**
   * Get a cell by its out point.
   * The cell will be cached if it is found.
   *
   * @param outPointLike - The out point of the cell to get.
   * @returns The cell if it exists, otherwise undefined.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const cell = await client.getCell({
   *   txHash: "0xTX_HASH...",
   *   index: 0,
   * });
   * if (cell) {
   *   console.log(`Capacity: ${ccc.fixedPointToString(cell.cellOutput.capacity)} CKB`);
   *   console.log(`Lock: ${cell.cellOutput.lock.codeHash}`);
   *   console.log(`Data: ${cell.outputData}`);
   * }
   * ```
   */
  getCell(outPointLike: OutPointLike): Promise<Cell | undefined>;
  getCellWithHeader(outPointLike: OutPointLike): Promise<{
    cell: Cell;
    header?: ClientBlockHeader;
  } | undefined>;
  abstract getCellLiveNoCache(outPointLike: OutPointLike, withData?: boolean | null, includeTxPool?: boolean | null): Promise<Cell | undefined>;
  /**
   * Get a live (unspent) cell by its out point.
   * Unlike getCell(), this verifies the cell is still live on-chain.
   *
   * @param outPointLike - The out point of the cell.
   * @param withData - Whether to include cell data.
   * @param includeTxPool - Whether to include cells in the transaction pool.
   * @returns The live cell, or undefined if spent or not found.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const cell = await client.getCellLive(
   *   { txHash: "0xTX_HASH...", index: 0 },
   *   true,  // include data
   *   true,  // include tx pool
   * );
   * if (cell) {
   *   console.log("Cell is still live!");
   * } else {
   *   console.log("Cell has been spent or does not exist.");
   * }
   * ```
   */
  getCellLive(outPointLike: OutPointLike, withData?: boolean | null, includeTxPool?: boolean | null): Promise<Cell | undefined>;
  abstract findCellsPagedNoCache(key: ClientIndexerSearchKeyLike, order?: "asc" | "desc", limit?: NumLike, after?: string): Promise<ClientFindCellsResponse>;
  /**
   * Find cells with pagination support.
   * Returns one page of results at a time with a cursor for the next page.
   *
   * @param key - The indexer search key.
   * @param order - Sort order ("asc" or "desc").
   * @param limit - Maximum cells per page.
   * @param after - Cursor from previous page for pagination.
   * @returns A page of cells with a cursor for the next page.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const { script: lock } = await ccc.Address.fromString("ckt1q...", client);
   *
   * // Get first page of cells
   * const page1 = await client.findCellsPaged({
   *   script: lock,
   *   scriptType: "lock",
   * }, "asc", 20);
   * console.log(`Found ${page1.cells.length} cells`);
   *
   * // Get next page
   * if (page1.cells.length === 20) {
   *   const page2 = await client.findCellsPaged(
   *     { script: lock, scriptType: "lock" },
   *     "asc", 20, page1.lastCursor,
   *   );
   * }
   * ```
   */
  findCellsPaged(key: ClientIndexerSearchKeyLike, order?: "asc" | "desc", limit?: NumLike, after?: string): Promise<ClientFindCellsResponse>;
  findCellsOnChain(key: ClientIndexerSearchKeyLike, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  /**
   * Find cells by search key designed for collectable cells.
   * The result also includes cached cells, the order param only works for cells fetched from RPC.
   *
   * @param keyLike - The search key.
   * @returns A async generator for yielding cells.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const { script: lock } = await ccc.Address.fromString("ckt1q...", client);
   *
   * // Find all cells owned by a lock script
   * for await (const cell of client.findCells({
   *   script: lock,
   *   scriptType: "lock",
   *   scriptSearchMode: "exact",
   *   withData: true,
   * })) {
   *   console.log(`Cell: ${cell.outPoint.txHash}:${cell.outPoint.index}`);
   *   console.log(`Capacity: ${ccc.fixedPointToString(cell.cellOutput.capacity)} CKB`);
   * }
   * ```
   */
  findCells(keyLike: ClientCollectableSearchKeyLike, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  /**
   * Find cells by lock script, optionally filtered by type script.
   *
   * @param lock - The lock script to search by.
   * @param type - Optional type script filter.
   * @param withData - Whether to include cell data (default: true).
   * @param order - Sort order by block number ("asc" or "desc").
   * @param limit - Page size for each RPC call (default: 10).
   * @returns An async generator yielding matching cells.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const { script: lock } = await ccc.Address.fromString("ckt1q...", client);
   *
   * // Find all cells belonging to this address
   * for await (const cell of client.findCellsByLock(lock)) {
   *   console.log(`${ccc.fixedPointToString(cell.cellOutput.capacity)} CKB`);
   * }
   *
   * // Find only xUDT cells belonging to this address
   * const xudtType = await ccc.Script.fromKnownScript(
   *   client, ccc.KnownScript.XUdt, "0xOWNER_LOCK_HASH...",
   * );
   * for await (const cell of client.findCellsByLock(lock, xudtType)) {
   *   console.log(`UDT cell found`);
   * }
   * ```
   */
  findCellsByLock(lock: ScriptLike, type?: ScriptLike | null, withData?: boolean, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  /**
   * Find cells by type script.
   *
   * @param type - The type script to search by.
   * @param withData - Whether to include cell data (default: true).
   * @param order - Sort order by block number.
   * @param limit - Page size for each RPC call (default: 10).
   * @returns An async generator yielding matching cells.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * // Find all xUDT cells of a specific token
   * const xudtType = await ccc.Script.fromKnownScript(
   *   client, ccc.KnownScript.XUdt, "0xOWNER_LOCK_HASH...",
   * );
   * for await (const cell of client.findCellsByType(xudtType)) {
   *   console.log(`Token cell: ${cell.outPoint.txHash}:${cell.outPoint.index}`);
   * }
   * ```
   */
  findCellsByType(type: ScriptLike, withData?: boolean, order?: "asc" | "desc", limit?: number): AsyncGenerator<Cell>;
  findSingletonCellByType(type: ScriptLike, withData?: boolean): Promise<Cell | undefined>;
  /**
   * Resolve cell dependency info into concrete CellDep objects.
   * If a CellDepInfo specifies a type script, the actual deployed cell is located on-chain.
   *
   * @param cellDepsInfoLike - One or more CellDepInfo or arrays of CellDepInfo.
   * @returns Resolved CellDep array ready to be added to a transaction.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const xudtInfo = await client.getKnownScript(ccc.KnownScript.XUdt);
   * const cellDeps = await client.getCellDeps(xudtInfo.cellDeps);
   * // cellDeps can be added to a transaction:
   * // tx.cellDeps.push(...cellDeps);
   * ```
   */
  getCellDeps(...cellDepsInfoLike: (CellDepInfoLike | CellDepInfoLike[])[]): Promise<CellDep[]>;
  abstract findTransactionsPaged(key: Omit<ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
    groupByTransaction: true;
  }, order?: "asc" | "desc", limit?: NumLike, after?: string): Promise<ClientFindTransactionsGroupedResponse>;
  abstract findTransactionsPaged(key: Omit<ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
    groupByTransaction?: false | null;
  }, order?: "asc" | "desc", limit?: NumLike, after?: string): Promise<ClientFindTransactionsResponse>;
  abstract findTransactionsPaged(key: ClientIndexerSearchKeyTransactionLike, order?: "asc" | "desc", limit?: NumLike, after?: string): Promise<ClientFindTransactionsResponse | ClientFindTransactionsGroupedResponse>;
  findTransactions(key: Omit<ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
    groupByTransaction: true;
  }, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsGroupedResponse["transactions"][0]>;
  findTransactions(key: Omit<ClientIndexerSearchKeyTransactionLike, "groupByTransaction"> & {
    groupByTransaction?: false | null;
  }, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0]>;
  findTransactions(key: ClientIndexerSearchKeyTransactionLike, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0] | ClientFindTransactionsGroupedResponse["transactions"][0]>;
  /**
   * Find transactions related to a lock script, optionally filtered by type script.
   *
   * @param lock - The lock script to search by.
   * @param type - Optional type script filter.
   * @param groupByTransaction - If true, group results by transaction.
   * @param order - Sort order by block number.
   * @param limit - Page size per RPC call.
   * @returns An async generator yielding transaction records.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const { script: lock } = await ccc.Address.fromString("ckt1q...", client);
   *
   * // List all transactions related to an address (grouped)
   * for await (const txRecord of client.findTransactionsByLock(lock, null, true)) {
   *   console.log(`TX: ${txRecord.txHash}, Block: ${txRecord.blockNumber}`);
   * }
   * ```
   */
  findTransactionsByLock(lock: ScriptLike, type: ScriptLike | undefined | null, groupByTransaction: true, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsGroupedResponse["transactions"][0]>;
  findTransactionsByLock(lock: ScriptLike, type?: ScriptLike | null, groupByTransaction?: false | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0]>;
  findTransactionsByLock(lock: ScriptLike, type?: ScriptLike | null, groupByTransaction?: boolean | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0] | ClientFindTransactionsGroupedResponse["transactions"][0]>;
  findTransactionsByType(type: ScriptLike, groupByTransaction: true, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsGroupedResponse["transactions"][0]>;
  findTransactionsByType(type: ScriptLike, groupByTransaction?: false | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0]>;
  findTransactionsByType(type: ScriptLike, groupByTransaction?: boolean | null, order?: "asc" | "desc", limit?: number): AsyncGenerator<ClientFindTransactionsResponse["transactions"][0] | ClientFindTransactionsGroupedResponse["transactions"][0]>;
  abstract getCellsCapacity(key: ClientIndexerSearchKeyLike): Promise<Num>;
  /**
   * Get the total CKB balance of a single lock script.
   * Only counts cells with no type script and no data (pure CKB capacity cells).
   *
   * @param lock - The lock script to query balance for.
   * @returns The total capacity in Shannons as a bigint.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const { script: lock } = await ccc.Address.fromString(
   *   "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq...",
   *   client,
   * );
   * const balance = await client.getBalanceSingle(lock);
   * console.log(`Balance: ${ccc.fixedPointToString(balance)} CKB`);
   * ```
   */
  getBalanceSingle(lock: ScriptLike): Promise<Num>;
  /**
   * Get the total CKB balance across multiple lock scripts.
   * Sums the balance from each lock script.
   *
   * @param locks - An array of lock scripts to query.
   * @returns The combined total capacity in Shannons as a bigint.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const signer = new ccc.SignerCkbPrivateKey(client, "0x...");
   * await signer.connect();
   *
   * const locks = await signer.getRecommendedAddressObj()
   *   .then(({ script }) => [script]);
   * const totalBalance = await client.getBalance(locks);
   * console.log(`Total: ${ccc.fixedPointToString(totalBalance)} CKB`);
   * ```
   */
  getBalance(locks: ScriptLike[]): Promise<Num>;
  /**
   * Send a signed transaction to the CKB network.
   * Validates the fee rate against the maximum before sending.
   *
   * @param transaction - The transaction to send.
   * @param validator - Optional outputs validator ("passthrough" or "well_known_scripts_only").
   * @param options - Optional configuration including maxFeeRate.
   * @returns The transaction hash.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const signer = new ccc.SignerCkbPrivateKey(client, "0x...");
   * await signer.connect();
   *
   * const tx = ccc.Transaction.from({
   *   outputs: [{ capacity: ccc.fixedPointFrom(100), lock: receiverLock }],
   * });
   * await tx.completeInputsByCapacity(signer);
   * await tx.completeFeeBy(signer);
   *
   * // Usually you call signer.sendTransaction(tx) which signs then sends.
   * // client.sendTransaction expects an already-signed transaction.
   * const txHash = await client.sendTransaction(tx);
   * ```
   */
  sendTransaction(transaction: TransactionLike, validator?: OutputsValidator, options?: {
    maxFeeRate?: NumLike;
  }): Promise<Hex>;
  /**
   * Get a transaction by its hash, including its status and block info.
   *
   * @param txHashLike - The transaction hash to look up.
   * @returns The transaction response with status, or undefined if not found.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * const txResponse = await client.getTransaction("0xTX_HASH...");
   * if (txResponse) {
   *   console.log(`Status: ${txResponse.status}`);
   *   console.log(`Block: ${txResponse.blockNumber}`);
   *   console.log(`Outputs: ${txResponse.transaction.outputs.length}`);
   * }
   * ```
   */
  getTransaction(txHashLike: HexLike): Promise<ClientTransactionResponse | undefined>;
  /**
   * This method gets specified transaction with its block header (if existed).
   * This is mainly for caching because we need the header to test if we can safely trust the cached tx status.
   * @param txHashLike
   */
  getTransactionWithHeader(txHashLike: HexLike): Promise<{
    transaction: ClientTransactionResponse;
    header?: ClientBlockHeader;
  } | undefined>;
  /**
   * Wait for a transaction to be confirmed on-chain.
   * Polls the node until the transaction reaches the specified confirmation depth.
   *
   * @param txHash - The transaction hash to wait for.
   * @param confirmations - Number of block confirmations to wait for (default: 0 = committed).
   * @param timeout - Maximum wait time in milliseconds (default: 60000).
   * @param interval - Polling interval in milliseconds (default: 2000).
   * @returns The transaction response once confirmed, or throws on timeout.
   *
   * @example
   * ```typescript
   * import { ccc } from "@ckb-ccc/core";
   *
   * const client = new ccc.ClientPublicTestnet();
   * // Wait for transaction to be committed (0 confirmations)
   * const tx = await client.waitTransaction("0xTX_HASH...");
   * console.log(`Confirmed in block: ${tx?.blockNumber}`);
   *
   * // Wait for 4 confirmations with 2 minute timeout
   * const confirmedTx = await client.waitTransaction(
   *   "0xTX_HASH...",
   *   4,       // confirmations
   *   120000,  // timeout: 2 minutes
   * );
   * ```
   */
  waitTransaction(txHash: HexLike, confirmations?: number, timeout?: number, interval?: number): Promise<ClientTransactionResponse | undefined>;
}
//#endregion
//#region src/client/jsonRpc/client.d.ts
type ClientJsonRpcConfig = RequestorJsonRpcConfig & {
  cache?: ClientCache;
  requestor?: RequestorJsonRpc;
};
/**
 * An abstract class implementing JSON-RPC client functionality for a specific URL and timeout.
 * Provides methods for sending transactions and building JSON-RPC payloads.
 */
declare abstract class ClientJsonRpc extends Client {
  readonly requestor: RequestorJsonRpc;
  /**
   * Creates an instance of ClientJsonRpc.
   *
   * @param url_ - The URL of the JSON-RPC server.
   * @param timeout - The timeout for requests in milliseconds
   */
  constructor(url_: string, config?: ClientJsonRpcConfig);
  /**
   * Returns the URL of the JSON-RPC server.
   *
   * @returns The URL of the JSON-RPC server.
   */
  get url(): string;
  /**
   * Get fee rate statistics
   *
   * @returns Fee rate statistics
   */
  getFeeRateStatistics: Client["getFeeRateStatistics"];
  /**
   * Get tip block number
   *
   * @returns Tip block number
   */
  getTip: () => Promise<Num>;
  /**
   * Get tip block header
   *
   * @param verbosity - result format which allows 0 and 1. (Optional, the default is 1.)
   * @returns BlockHeader
   */
  getTipHeader: Client["getTipHeader"];
  /**
   * Get block by block number
   *
   * @param blockNumber - The block number.
   * @param verbosity - result format which allows 0 and 2. (Optional, the default is 2.)
   * @param withCycles - whether the return cycles of block transactions. (Optional, default false.)
   * @returns Block
   */
  getBlockByNumberNoCache: Client["getBlockByNumberNoCache"];
  /**
   * Get block by block hash
   *
   * @param blockHash - The block hash.
   * @param verbosity - result format which allows 0 and 2. (Optional, the default is 2.)
   * @param withCycles - whether the return cycles of block transactions. (Optional, default false.)
   * @returns Block
   */
  getBlockByHashNoCache: Client["getBlockByHashNoCache"];
  /**
   * Get header by block number
   *
   * @param blockNumber - The block number.
   * @param verbosity - result format which allows 0 and 1. (Optional, the default is 1.)
   * @returns BlockHeader
   */
  getHeaderByNumberNoCache: Client["getHeaderByNumberNoCache"];
  /**
   * Get header by block hash
   *
   * @param blockHash - The block hash.
   * @param verbosity - result format which allows 0 and 1. (Optional, the default is 1.)
   * @returns BlockHeader
   */
  getHeaderByHashNoCache: Client["getHeaderByHashNoCache"];
  /**
   * Estimate cycles of a transaction.
   *
   * @param transaction - The transaction to estimate.
   * @returns Consumed cycles
   */
  estimateCycles: Client["estimateCycles"];
  /**
   * Test a transaction.
   *
   * @param transaction - The transaction to test.
   * @param validator - "passthrough": Disable validation. "well_known_scripts_only": Only accept well known scripts in the transaction.
   * @returns Consumed cycles
   */
  sendTransactionDry: Client["sendTransactionDry"];
  /**
   * Send a transaction to node.
   *
   * @param transaction - The transaction to send.
   * @param validator - "passthrough": Disable validation. "well_known_scripts_only": Only accept well known scripts in the transaction.
   * @returns Transaction hash.
   */
  sendTransactionNoCache: (transaction: TransactionLike, validator?: OutputsValidator | null) => Promise<Hex>;
  /**
   * Get a transaction from node.
   *
   * @param txHash - The hash of the transaction.
   * @returns The transaction with status.
   */
  getTransactionNoCache: (txHash: HexLike) => Promise<ClientTransactionResponse | undefined>;
  /**
   * Get a live cell from node.
   *
   * @param outPoint - The out point of the cell.
   * @param withData - Include data in the response.
   * @param includeTxPool - Include cells in the tx pool.
   * @returns The cell
   */
  getCellLiveNoCache(outPoint: OutPointLike, withData?: boolean | null, includeTxPool?: boolean | null): Promise<Cell | undefined>;
  /**
   * find cells from node.
   *
   * @param key - The search key of cells.
   * @param order - The order of cells.
   * @param limit - The max return size of cells.
   * @param after - Pagination parameter.
   * @returns The found cells.
   */
  findCellsPagedNoCache: (key: ClientIndexerSearchKeyLike, order?: "asc" | "desc", limit?: NumLike, after?: string) => Promise<ClientFindCellsResponse>;
  /**
   * find transactions from node.
   *
   * @param key - The search key of transactions.
   * @param order - The order of transactions.
   * @param limit - The max return size of transactions.
   * @param after - Pagination parameter.
   * @returns The found transactions.
   */
  findTransactionsPaged: Client["findTransactionsPaged"];
  /**
   * get cells capacity from node.
   *
   * @param key - The search key of cells.
   * @returns The sum of cells capacity.
   */
  getCellsCapacity: (key: ClientIndexerSearchKeyLike) => Promise<Num>;
  /**
   * Builds a sender function for a JSON-RPC method.
   *
   * @param rpcMethod - The JSON-RPC method.
   * @param inTransformers - An array of input transformers.
   * @param outTransformer - An output transformer function.
   * @returns A function that sends a JSON-RPC request with the given method and transformed parameters.
   */
  buildSender(rpcMethod: Parameters<RequestorJsonRpc["request"]>[0], inTransformers?: Parameters<RequestorJsonRpc["request"]>[2], outTransformer?: Parameters<RequestorJsonRpc["request"]>[3]): (...req: unknown[]) => Promise<unknown>;
}
//#endregion
//#region src/client/clientPublicMainnet.d.ts
/**
 * @public
 */
declare class ClientPublicMainnet extends ClientJsonRpc {
  private readonly config?;
  constructor(config?: (ClientJsonRpcConfig & {
    url?: string;
    scripts?: Record<KnownScript, ScriptInfoLike | undefined>;
  }) | undefined);
  get scripts(): Record<KnownScript, ScriptInfoLike | undefined>;
  get addressPrefix(): string;
  getKnownScript(script: KnownScript): Promise<ScriptInfo>;
}
//#endregion
//#region src/client/clientPublicTestnet.d.ts
/**
 * @public
 */
declare class ClientPublicTestnet extends ClientJsonRpc {
  private readonly config?;
  constructor(config?: (ClientJsonRpcConfig & {
    url?: string;
    scripts?: Record<KnownScript, ScriptInfoLike | undefined>;
  }) | undefined);
  get scripts(): Record<KnownScript, ScriptInfoLike | undefined>;
  get addressPrefix(): string;
  getKnownScript(script: KnownScript): Promise<ScriptInfo>;
}
//#endregion
//#region src/address/address.advanced.d.ts
/**
 * Parses an address string into an address information object.
 *
 * @param address - The address string to parse.
 * @returns An object containing the address prefix, address format, and payload array.
 *
 * @throws Will throw an error if the address format is unknown.
 *
 * @example
 * ```typescript
 * const addressInfo = addressPayloadFromString("ckt1112139193129");
 * console.log(addressInfo.prefix); // Outputs the address prefix
 * console.log(addressInfo.format); // Outputs the address format
 * console.log(addressInfo.payload); // Outputs the payload array
 * ```
 */
declare function addressPayloadFromString(address: string): {
  prefix: string;
  format: AddressFormat;
  payload: number[];
};
/**
 * Converts an address payload into an address-like object.
 *
 * @param prefix - The address prefix.
 * @param format - The format of the address, as defined by the AddressFormat enum.
 * @param payload - The payload array containing the address data.
 * @param client - The client instance used to fetch known scripts.
 * @returns A promise that resolves to an AddressLike object.
 *
 * @throws Will throw an error if the payload length is insufficient or if the script type is unknown.
 *
 * @example
 * ```typescript
 * const address = await addressFromPayload("ckt", AddressFormat.Full, [/* payload data *\/], client);
 * console.log(address.script); // Outputs the script object
 * console.log(address.prefix); // Outputs the address prefix
 * ```
 */
declare function addressFromPayload(prefix: string, format: AddressFormat, payload: number[], client: Client): Promise<AddressLike>;
declare enum AddressFormat {
  /**
   * full version identifies the hashType
   */
  Full = 0,
  /**
   * @deprecated
   * short version for locks with Known codeHash, deprecated
   */
  Short = 1,
  /**
   * @deprecated
   * full version with hashType = "Data", deprecated
   */
  FullData = 2,
  /**
   * @deprecated
   * full version with hashType = "Type", deprecated
   */
  FullType = 4
}
declare const ADDRESS_BECH32_LIMIT = 1023;
//#endregion
//#region src/ckb/script.advanced.d.ts
declare const HASH_TYPE_TO_NUM: Record<HashType, number>;
declare const NUM_TO_HASH_TYPE: Record<number, HashType>;
declare const HASH_TYPES: string[];
//#endregion
//#region src/ckb/transaction.advanced.d.ts
declare const DEP_TYPE_TO_NUM: Record<DepType, number>;
declare const NUM_TO_DEP_TYPE: Record<number, DepType>;
declare const DEP_TYPES: string[];
//#endregion
//#region src/client/cache/memory.advanced.d.ts
declare const DEFAULT_CONFIRMED_BLOCK_TIME: bigint;
type CellRecord = [false, Pick<Cell, "outPoint"> & Partial<Pick<Cell, "cellOutput" | "outputData">>] | [true, Cell] | [undefined, Cell];
declare function filterData(dataLike: HexLike, filterLike: HexLike | undefined, filterMode: "exact" | "prefix" | "partial"): boolean;
declare function filterScript(valueLike: ScriptLike | undefined, filterLike: ScriptLike | undefined, filterMode: "prefix" | "exact" | "partial"): boolean;
declare function filterNumByRange(lengthLike: NumLike, range: [NumLike, NumLike] | undefined): boolean;
declare function filterScriptByLenRange(valueLike?: ScriptLike, scriptLenRange?: [NumLike, NumLike]): boolean;
declare function filterCell(searchKeyLike: ClientCollectableSearchKeyLike, cellLike: CellLike): boolean;
/**
 * A Map-like class that implements a "Least Recently Used" (LRU) cache policy.
 * When the cache reaches its capacity, the least recently used item is removed.
 * @public
 */
declare class MapLru<K, V> extends Map<K, V> {
  private readonly capacity;
  private readonly lru;
  /**
   * @param capacity - The maximum number of items to store in the cache. Must be a positive integer.
   */
  constructor(capacity: number);
  /**
   * Retrieves the value for a given key and marks it as recently used.
   * @param key - The key of the element to retrieve.
   * @returns The value associated with the key, or `undefined` if the key is not in the cache.
   */
  get(key: K): V | undefined;
  /**
   * Adds or updates a key-value pair in the cache and marks the key as recently used.
   * If setting a new key causes the cache to exceed its capacity, the least recently used item is evicted.
   * @param key - The key of the element to add or update.
   * @param value - The value of the element to add or update.
   * @returns The `MapLru` instance.
   */
  set(key: K, value: V): this;
  /**
   * Removes the specified element from the cache.
   * @param key - The key of the element to remove.
   * @returns `true` if an element in the `MapLru` object existed and has been removed, or `false` if the element does not exist.
   */
  delete(key: K): boolean;
  /**
   * Removes all key-value pairs from the cache.
   */
  clear(): void;
}
//#endregion
//#region src/client/clientPublicMainnet.advanced.d.ts
declare const MAINNET_SCRIPTS: Record<KnownScript, ScriptInfoLike | undefined>;
//#endregion
//#region src/client/clientPublicTestnet.advanced.d.ts
declare const TESTNET_SCRIPTS: Record<KnownScript, ScriptInfoLike>;
//#endregion
//#region src/client/jsonRpc/types.d.ts
type JsonRpcHashType = "type" | "data" | "data1" | "data2";
type JsonRpcDepType = "dep_group" | "code";
type JsonRpcScript = {
  code_hash: Hex;
  hash_type: JsonRpcHashType;
  args: Hex;
};
type JsonRpcOutPoint = {
  index: Hex;
  tx_hash: Hex;
};
type JsonRpcCellInput = {
  previous_output: JsonRpcOutPoint;
  since: Hex;
};
type JsonRpcCellOutput = {
  capacity: Hex;
  lock: JsonRpcScript;
  type?: JsonRpcScript;
};
type JsonRpcCellDep = {
  out_point: JsonRpcOutPoint;
  dep_type: JsonRpcDepType;
};
type JsonRpcTransaction = {
  version: Hex;
  cell_deps: JsonRpcCellDep[];
  header_deps: Hex[];
  inputs: JsonRpcCellInput[];
  outputs: JsonRpcCellOutput[];
  outputs_data: Hex[];
  witnesses: Hex[];
};
type JsonRpcBlockHeader = {
  compact_target: Hex;
  dao: Hex;
  epoch: Hex;
  extra_hash: Hex;
  hash: Hex;
  nonce: Hex;
  number: Hex;
  parent_hash: Hex;
  proposals_hash: Hex;
  timestamp: Hex;
  transactions_root: Hex;
  version: Hex;
};
type JsonRpcBlockUncle = {
  header: JsonRpcBlockHeader;
  proposals: Hex[];
};
type JsonRpcBlock = {
  header: JsonRpcBlockHeader;
  proposals: Hex[];
  transactions: JsonRpcTransaction[];
  uncles: JsonRpcBlockUncle[];
};
type JsonRpcIndexerSearchKeyFilter = {
  script?: JsonRpcScript;
  script_len_range?: [Hex, Hex];
  output_data?: Hex;
  output_data_filter_mode?: "prefix" | "exact" | "partial";
  output_data_len_range?: [Hex, Hex];
  output_capacity_range?: [Hex, Hex];
  block_range?: [Hex, Hex];
};
type JsonRpcIndexerSearchKey = {
  script: JsonRpcScript;
  script_type: "lock" | "type";
  script_search_mode?: "prefix" | "exact" | "partial";
  filter?: JsonRpcIndexerSearchKeyFilter;
  with_data?: boolean;
};
type JsonRpcIndexerSearchKeyTransaction = {
  script: JsonRpcScript;
  script_type: "lock" | "type";
  script_search_mode?: "prefix" | "exact" | "partial";
  filter?: JsonRpcIndexerSearchKeyFilter;
  group_by_transaction?: boolean;
};
type JsonRpcIndexerFindTransactionsResponse = {
  last_cursor: string;
  objects: {
    tx_hash: Hex;
    block_number: Hex;
    tx_index: Hex;
    io_type: "input" | "output";
    io_index: Hex;
  }[];
};
type JsonRpcIndexerFindTransactionsGroupedResponse = {
  last_cursor: string;
  objects: {
    tx_hash: Hex;
    block_number: Hex;
    tx_index: Hex;
    cells: ["input" | "output", Hex][];
  }[];
};
//#endregion
//#region src/client/jsonRpc/transformers.d.ts
declare class JsonRpcTransformers {
  static hashTypeFrom(hashType: HashTypeLike): JsonRpcHashType;
  static hashTypeTo(hashType: JsonRpcHashType): HashType;
  static depTypeFrom(depType: DepTypeLike): JsonRpcDepType;
  static depTypeTo(depType: JsonRpcDepType): DepType;
  static scriptFrom(scriptLike: ScriptLike): JsonRpcScript;
  static scriptTo(script: JsonRpcScript): Script;
  static outPointFrom(outPointLike: OutPointLike): JsonRpcOutPoint;
  static outPointTo(outPoint: JsonRpcOutPoint): OutPoint;
  static cellInputFrom(cellInputLike: CellInputLike): JsonRpcCellInput;
  static cellInputTo(cellInput: JsonRpcCellInput): CellInput;
  static cellOutputFrom(cellOutputLike: CellOutputLike, outputData?: HexLike | null): JsonRpcCellOutput;
  static cellOutputTo(cellOutput: JsonRpcCellOutput): CellOutput;
  static cellDepFrom(cellDep: CellDepLike): JsonRpcCellDep;
  static cellDepTo(cellDep: JsonRpcCellDep): CellDep;
  static transactionFrom(txLike: TransactionLike): JsonRpcTransaction;
  static transactionTo(tx: JsonRpcTransaction): Transaction;
  static transactionResponseTo({
    cycles,
    tx_status: {
      status,
      block_number,
      block_hash,
      tx_index,
      reason
    },
    transaction
  }: {
    cycles?: NumLike;
    tx_status: {
      status: TransactionStatus;
      block_hash?: HexLike;
      tx_index?: NumLike;
      block_number?: NumLike;
      reason?: string;
    };
    transaction: JsonRpcTransaction | null;
  }): ClientTransactionResponse | undefined;
  static blockHeaderTo(header: JsonRpcBlockHeader): ClientBlockHeader;
  static blockUncleTo(block: JsonRpcBlockUncle): ClientBlockUncle;
  static blockTo(block: JsonRpcBlock): ClientBlock;
  static rangeFrom([a, b]: [NumLike, NumLike]): [Hex, Hex];
  static indexerSearchKeyFilterFrom(filter: ClientIndexerSearchKeyFilter): JsonRpcIndexerSearchKeyFilter;
  static indexerSearchKeyFrom(keyLike: ClientIndexerSearchKeyLike): JsonRpcIndexerSearchKey;
  static findCellsResponseTo({
    last_cursor,
    objects
  }: {
    last_cursor: string;
    objects: {
      out_point: JsonRpcOutPoint;
      output: JsonRpcCellOutput;
      output_data?: Hex;
    }[];
  }): ClientFindCellsResponse;
  static indexerSearchKeyTransactionFrom(keyLike: ClientIndexerSearchKeyTransactionLike): JsonRpcIndexerSearchKeyTransaction;
  static findTransactionsResponseTo({
    last_cursor,
    objects
  }: JsonRpcIndexerFindTransactionsResponse | JsonRpcIndexerFindTransactionsGroupedResponse): ClientFindTransactionsResponse | ClientFindTransactionsGroupedResponse;
}
//#endregion
//#region src/hasher/advanced.d.ts
declare const CKB_BLAKE2B_PERSONAL: Bytes$1;
declare namespace advancedBarrel_d_exports {
  export { ADDRESS_BECH32_LIMIT, AddressFormat, BytesFromEncoding, CKB_BLAKE2B_PERSONAL, CellRecord, ClientCollectableSearchKeyFilterLike, ClientCollectableSearchKeyLike, DEFAULT_CONFIRMED_BLOCK_TIME, DEFAULT_MAX_FEE_RATE, DEFAULT_MIN_FEE_RATE, DEP_TYPES, DEP_TYPE_TO_NUM, HASH_TYPES, HASH_TYPE_TO_NUM, JsonRpcBlock, JsonRpcBlockHeader, JsonRpcBlockUncle, JsonRpcCellDep, JsonRpcCellInput, JsonRpcCellOutput, JsonRpcDepType, JsonRpcHashType, JsonRpcIndexerFindTransactionsGroupedResponse, JsonRpcIndexerFindTransactionsResponse, JsonRpcIndexerSearchKey, JsonRpcIndexerSearchKeyFilter, JsonRpcIndexerSearchKeyTransaction, JsonRpcOutPoint, JsonRpcPayload, JsonRpcScript, JsonRpcTransaction, JsonRpcTransformers, MAINNET_SCRIPTS, MapLru, NUM_TO_DEP_TYPE, NUM_TO_HASH_TYPE, TESTNET_SCRIPTS, Transport, TransportFallback, TransportHttp, TransportWebSocket, addressFromPayload, addressPayloadFromString, clientSearchKeyRangeFrom, filterCell, filterData, filterNumByRange, filterScript, filterScriptByLenRange, transportFromUri };
}
//#endregion
export { CellDep as $, AddressLike as $i, SignerCkbPublicKey as $n, CodecByte16 as $r, ClientFindCellsResponse as $t, DEP_TYPES as A, apply as Ai, verifyMessageNostrEvent as An, RequestorJsonRpc as Ar, HashTypeCodec as At, ClientPublicTestnet as B, numFrom as Bi, SignerDummy as Bn, HASH_CKB_SHORT_LENGTH as Br, Epoch as Bt, DEFAULT_CONFIRMED_BLOCK_TIME as C, CodecUint8 as Ci, ClientCollectableSearchKeyLike as Cn, InputToSign as Cr, depTypeFrom as Ct, filterNumByRange as D, Entity as Di, barrel_d_exports as Dn, barrel_d_exports$1 as Dr, udtBalanceFrom as Dt, filterData as E, codecUintNumber as Ei, clientSearchKeyRangeFrom as En, SignPsbtOptionsLike as Er, isDaoOutputLimitExceeded as Et, NUM_TO_HASH_TYPE as F, stringify as Fi, verifyMessageEvmPersonal as Fn, TransportHttp as Fr, ScriptVec as Ft, ClientCacheMemory as G, numMin as Gi, SignerDoge as Gn, FixedPoint as Gr, CellDepInfo as Gt, ClientJsonRpc as H, numLeFromBytes as Hi, verifyMessageDogeEcdsa as Hn, hashCkb as Hr, epochFrom as Ht, ADDRESS_BECH32_LIMIT as I, Num as Ii, SignerEvmAddressReadonly as In, JsonRpcPayload as Ir, hashTypeFrom as It, ErrorTransactionInsufficientCoin as J, Codec as Ji, MultisigCkbWitness as Jn, Zero as Jr, ClientBlockHeader as Jt, ClientCache as K, numToBytes as Ki, verifyMessageJoyId as Kn, FixedPointLike as Kr, CellDepInfoLike as Kt, AddressFormat as L, NumLike as Li, SignerEvm as Ln, Transport as Lr, hashTypeFromBytes as Lt, NUM_TO_DEP_TYPE as M, isWebview as Mi, SignerNostrPublicKeyReadonly as Mn, TransportFallback as Mr, Script as Mt, HASH_TYPES as N, reduceAsync as Ni, NostrEvent as Nn, transportFromUri as Nr, ScriptLike as Nt, filterScript as O, codec as Oi, buildNostrEventFromMessage as On, keystoreDecrypt as Or, LumosTransactionSkeletonType as Ot, HASH_TYPE_TO_NUM as P, sleep as Pi, SignerNostr as Pn, TransportWebSocket as Pr, ScriptOpt as Pt, CellAnyLike as Q, Address as Qi, SignerCkbPrivateKey as Qn, CodecByte as Qr, ClientBlockUncleLike as Qt, addressFromPayload as R, numBeFromBytes as Ri, SignerOpenLink as Rn, HasherKeecak256 as Rr, hashTypeToBytes as Rt, CellRecord as S, CodecUint64LE as Si, ClientCollectableSearchKeyFilterLike as Sn, Wallet as Sr, calcDaoProfit as St, filterCell as T, codecUint as Ti, DEFAULT_MIN_FEE_RATE as Tn, SignPsbtOptions as Tr, depTypeToBytes as Tt, ClientJsonRpcConfig as U, numLeToBytes as Ui, SignerDogePrivateKey as Un, hashCkbShort as Ur, epochFromHex as Ut, ClientPublicMainnet as V, numFromBytes as Vi, messageHashDogeEcdsa as Vn, HasherCkb as Vr, EpochLike as Vt, Client as W, numMax as Wi, SignerDogeAddressReadonly as Wn, Hasher as Wr, epochToHex as Wt, Cell as X, DecodedType as Xi, SignerMultisigCkbReadonly as Xn, fixedPointToString as Xr, ClientBlockLike as Xt, hashTypeId as Y, CodecLike as Yi, MultisigCkbWitnessLike as Yn, fixedPointFrom as Yr, ClientBlockHeaderLike as Yt, CellAny as Z, EncodableType as Zi, SignerCkbScriptReadonly as Zn, CodecBool as Zr, ClientBlockUncle as Zt, JsonRpcOutPoint as _, CodecUint512 as _i, ErrorClientWaitTransactionTimeout as _n, SignerInfo as _r, Transaction as _t, JsonRpcBlockHeader as a, Bytes$1 as aa, CodecUint128 as ai, ClientIndexerSearchKeyLike as an, verifyMessageSecp256k1 as ar, CellLike as at, TESTNET_SCRIPTS as b, CodecUint64 as bi, ScriptInfoLike as bn, SignerSignType as br, WitnessArgsLike as bt, JsonRpcCellInput as c, bytesConcatTo as ca, CodecUint16 as ci, ClientTransactionResponse as cn, btcPublicKeyFromP2pkhAddress as cr, CellOutputVec as ct, JsonRpcHashType as d, bytesTo as da, CodecUint256 as di, ErrorClientBaseLike as dn, verifyMessageBtcEcdsa as dr, DepTypeLike as dt, Hex as ea, CodecByte32 as ei, ClientFindTransactionsGroupedResponse as en, SECP256K1_SIGNATURE_LENGTH as er, CellDepLike as et, JsonRpcIndexerFindTransactionsGroupedResponse as f, BytesFromEncoding as fa, CodecUint256BE as fi, ErrorClientDuplicatedTransaction as fn, SignerBtcPublicKeyReadonly as fr, OutPoint as ft, JsonRpcIndexerSearchKeyTransaction as g, CodecUint32LE as gi, ErrorClientVerification as gn, Signer as gr, SinceLike as gt, JsonRpcIndexerSearchKeyFilter as h, CodecUint32BE as hi, ErrorClientResolveUnknown as hn, Signature as hr, Since as ht, JsonRpcBlock as i, hexFrom as ia, CodecRaw as ii, ClientIndexerSearchKeyFilterLike as in, verifyMessageCkbSecp256k1 as ir, CellInputVec as it, DEP_TYPE_TO_NUM as j, gcd as ji, SignerNostrPrivateKey as jn, RequestorJsonRpcConfig as jr, HashTypeLike as jt, filterScriptByLenRange as k, Constructor as ki, nostrEventHash as kn, keystoreEncrypt as kr, HashType as kt, JsonRpcCellOutput as l, bytesEq as la, CodecUint16BE as li, ClientTransactionResponseLike as ln, btcVarLengthBytesFrom as lr, DepType as lt, JsonRpcIndexerSearchKey as m, CodecUint32 as mi, ErrorClientRBFRejected as mn, NetworkPreference as mr, RawTransaction as mt, CKB_BLAKE2B_PERSONAL as n, bytesLen as na, CodecByte8 as ni, ClientIndexerSearchKey as nn, recoverMessageSecp256k1 as nr, CellInput as nt, JsonRpcBlockUncle as o, BytesLike as oa, CodecUint128BE as oi, ClientIndexerSearchKeyTransaction as on, btcEcdsaPublicKeyHash as or, CellOutput as ot, JsonRpcIndexerFindTransactionsResponse as p, CodecUint256LE as pi, ErrorClientMaxFeeRateExceeded as pn, SignerBtc as pr, OutPointLike as pt, ErrorTransactionInsufficientCapacity as q, numToHex as qi, SignerMultisigCkbPrivateKey as qn, One as qr, ClientBlock as qt, JsonRpcTransformers as r, bytesLenUnsafe as ra, CodecBytes as ri, ClientIndexerSearchKeyFilter as rn, signMessageSecp256k1 as rr, CellInputLike as rt, JsonRpcCellDep as s, bytesConcat as sa, CodecUint128LE as si, ClientIndexerSearchKeyTransactionLike as sn, btcP2pkhAddressFromPublicKey as sr, CellOutputLike as st, advancedBarrel_d_exports as t, HexLike as ta, CodecByte4 as ti, ClientFindTransactionsResponse as tn, messageHashCkbSecp256k1 as tr, CellDepVec as tt, JsonRpcDepType as u, bytesFrom as ua, CodecUint16LE as ui, ErrorClientBase as un, messageHashBtcEcdsa as ur, DepTypeCodec as ut, JsonRpcScript as v, CodecUint512BE as vi, OutputsValidator as vn, SignerMultisig as vr, TransactionLike as vt, MapLru as w, codecPadding as wi, DEFAULT_MAX_FEE_RATE as wn, InputToSignLike as wr, depTypeFromBytes as wt, MAINNET_SCRIPTS as x, CodecUint64BE as xi, TransactionStatus as xn, SignerType as xr, calcDaoClaimEpoch as xt, JsonRpcTransaction as y, CodecUint512LE as yi, ScriptInfo as yn, SignerMultisigNotEnoughSignaturesError as yr, WitnessArgs as yt, addressPayloadFromString as z, numBeToBytes as zi, SignerAlwaysError as zn, HASH_CKB_LENGTH as zr, KnownScript as zt };
//# sourceMappingURL=advancedBarrel-CiJnF8me.d.ts.map