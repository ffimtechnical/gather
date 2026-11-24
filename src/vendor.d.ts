declare module 'open-location-code' {
  export class OpenLocationCode {
    isValid(code: string): boolean;
    isShort(code: string): boolean;
    isFull(code: string): boolean;
    encode(lat: number, lng: number, length?: number): string;
    decode(code: string): { latitudeCenter: number; longitudeCenter: number };
    recoverNearest(code: string, lat: number, lng: number): string;
  }
}
