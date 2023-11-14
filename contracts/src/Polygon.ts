import {
  Field,
  Struct,
  Experimental,
  SelfProof,
  Empty,
} from 'o1js';
import { ThreePointPolygon, GeoPoint } from './model/Geography.js';

function proveCoordinatesIn3PointPolygon2(
  input: LiteralCoordinatesAndTimeStamp,
): GeoPoint {
  return input.point;
}

class IntervalTimeStamp extends Struct({
  start: Field,
  end: Field,
}) { }

class LiteralCoordinatesAndTimeStamp extends Struct({
  point: GeoPoint,
  timestamp: IntervalTimeStamp,
}) { }

export const CoordinateSourceFromGoogle = Experimental.ZkProgram({
  publicOutput: GeoPoint,

  methods: {
    proveCoordinatesIn3PointPolygon2: {
      privateInputs: [LiteralCoordinatesAndTimeStamp],
      method: proveCoordinatesIn3PointPolygon2,
    },
  }
});

function demoMethod(coordinates: SelfProof<Empty, GeoPoint>, polygon: ThreePointPolygon) {
  coordinates.verify();
  const validatedCoords: GeoPoint = coordinates.publicOutput;
}

export const CoordinateUsage = Experimental.ZkProgram({

  methods: {
    proveCoordinatesIn3PointPolygon: {
      privateInputs: [SelfProof<Empty, GeoPoint>, ThreePointPolygon],
      method: demoMethod,
    },
  },
});
