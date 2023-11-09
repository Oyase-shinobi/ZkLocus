import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Struct,
  Poseidon,
  Bool,
  Experimental,
  SelfProof,
  Empty,
  Provable,
  Int64,
  UInt64,
  Sign,
} from 'o1js';
import { Int64Prover } from './math/Provers.js';
import { Int64Asserter } from './math/Asserters.js';

/** Data Structures */

/**
 * Represents a geographical point. The point is represented as a pair of latitude and longitude values.
 * The latitude and longitude values are represented as Field values. The Field values are scaled to
 * the desired factor, in order to represent the desired percision. The percision is represented as
 * a Field value. The percision is the number of decimal points that the latitude and longitude values
 * have. For example, if the percision is 7, then the latitude and longitude values are scaled to
 * 7 decimal points. The latitude and longitude values are scaled by multiplying them with 10^7.
 * 10^7 is the scale factor. `factor` is used instead of percision to optimize the efficency, as it prevent
  the need to perform exponentiation computations
 */
export class GeographicalPoint extends Struct({
  latitude: Int64,
  longitude: Int64,
  factor: Int64, // see note in docs
}) {
  hash() {
    return Poseidon.hash([
      this.latitude.toField(),
      this.longitude.toField(),
      this.factor.toField(),
    ]);
  }

  assertIsValid(): void {
    // First, asser that the provided latidude and logitude values are within the accepted range
    this.latitude.div(this.factor).magnitude.assertLessThanOrEqual(UInt64.from(90));
    this.longitude.magnitude.assertLessThanOrEqual(UInt64.from(180));
    this.factor.magnitude.assertLessThanOrEqual(UInt64.from(10n ** 7n)); // maximum percions is 7 decimal points
  }
}

export class NoncedGeographicalPoint extends Struct({
  point: GeographicalPoint,
  nonce: Field,
}) {
  hash() {
    return Poseidon.hash([this.point.hash(), this.nonce]);
  }

  assertIsValid(): void {
    this.point.assertIsValid();
  }
}

export class ThreePointPolygon extends Struct({
  vertice1: GeographicalPoint,
  vertice2: GeographicalPoint,
  vertice3: GeographicalPoint,
}) {
  hash() {
    return Poseidon.hash([
      this.vertice1.hash(),
      this.vertice2.hash(),
      this.vertice3.hash(),
    ]);
  }

  /**
   * Ensure that the `ThreePointPolygon` instance is valid. This includes
   * asserting that the coordinates are within the allowed values, and that
   * those coordinates are ordered correctly.
   */
  assertIsValid(): void {
    this.assertIsVerticesValid();
    this.assertIsOrderingValid();
  }

  private assertIsVerticesValid(): void {
    this.vertice1.assertIsValid();
    this.vertice2.assertIsValid();
    this.vertice3.assertIsValid();
  }

  private assertIsOrderingValid(): void {
    // TODO: assert that the points in the polygon are correcly ordered
  }
}

export class CoordinateProofState extends Struct({
  polygonCommitment: Field,
  // TODO: consider including outSidePolygonCommitment proofs, in order to inlcude the "inner" and "outer" polygon definitions of GeoJSON
  //outsidePolygonCommitment: Field,
  coordinatesCommitment: Field, // IMPORTANT: without a nonce, this leaks the coordinates
  isInPolygon: Bool,
}) {
  toString(): string {
    return `Polygon Commitment: ${this.polygonCommitment.toString()}\nCoordinates Commitment: ${this.coordinatesCommitment.toString()}\nIs In Polygon: ${this.isInPolygon.toString()}`;
  }
}

class CoordinatePolygonInclusionExclusionProof extends Struct({
  insidePolygonCommitment: Field,
  outsidePolygonCommitment: Field,
  coordinatesCommitment: Field,
}) {
  toString(): string {
    return `Inside Polygon Commitment: ${this.insidePolygonCommitment.toString()}\nOutside Polygon Commitment: ${this.outsidePolygonCommitment.toString()}\nCoordinates Commitment: ${this.coordinatesCommitment.toString()}`;
  }
}

class ProoveCoordinatesIn3dPolygonArgumentsValues extends Struct({
  point: GeographicalPoint,
  polygon: ThreePointPolygon,
}) { }

/** Intermediate Circuits **/

function verifyProoveCoordinatesIn3dPolygonArguments(
  point: NoncedGeographicalPoint,
  polygon: ThreePointPolygon
): ProoveCoordinatesIn3dPolygonArgumentsValues {
  // First, ensure all of the coordinates are valid
  point.assertIsValid();
  polygon.vertice1.assertIsValid();
  polygon.vertice2.assertIsValid();
  polygon.vertice3.assertIsValid();

  // Next, ensure all of the points have the same factor
  const expectedFactor: Int64 = point.point.factor;
  expectedFactor.assertEquals(polygon.vertice1.factor);
  expectedFactor.assertEquals(polygon.vertice2.factor);
  expectedFactor.assertEquals(polygon.vertice3.factor);

  return new ProoveCoordinatesIn3dPolygonArgumentsValues({
    point: point.point,
    polygon: polygon,
  });
}

export const ProoveCoordinatesIn3dPolygonArguments = Experimental.ZkProgram({
  publicOutput: ProoveCoordinatesIn3dPolygonArgumentsValues,

  methods: {
    verifyArguments: {
      privateInputs: [NoncedGeographicalPoint, ThreePointPolygon],
      method: verifyProoveCoordinatesIn3dPolygonArguments,
    },
  },
});

/** Main Circuits */

function isPointOnEdgeProvable(point: NoncedGeographicalPoint, vertice1: GeographicalPoint, vertice2: GeographicalPoint) {
  const x: Int64 = point.point.latitude;
  const y: Int64 = point.point.longitude;
  const x1: Int64 = vertice1.latitude; // edge start
  const y1: Int64 = vertice1.longitude; // edge start
  const x2: Int64 = vertice2.latitude;  // edge end
  const y2: Int64 = vertice2.longitude; // edge end

  const isX1LargerThanX2: Bool = Int64Prover.provableIsInt64XGreaterThanY(x1, x2);
  let maximumX: Int64 = Provable.if(isX1LargerThanX2, x1, x2);
  let minimumX: Int64 = Provable.if(isX1LargerThanX2, x2, x1);

  const isY1LargerThanY2: Bool = Int64Prover.provableIsInt64XGreaterThanY(y1, y2);
  let maximumY: Int64 = Provable.if(isY1LargerThanY2, y1, y2);
  let minimumY: Int64 = Provable.if(isY1LargerThanY2, y2, y1);

  const withinXBounds = Int64Prover.provableIsInt64XLessThanOrEqualY(x, maximumX).and(Int64Prover.provableIsInt64XLessThanOrEqualY(minimumX, x));
  const withinYBounds = Int64Prover.provableIsInt64XLessThanOrEqualY(y, maximumY).and(Int64Prover.provableIsInt64XLessThanOrEqualY(minimumY, y));

  // Check if the point satisfies the line equation for the edge
  const xDifference1: Int64 = x2.sub(x1);
  const xDifference2: Int64 = x.sub(x1);
  const yDiffernce1: Int64 = y2.sub(y1);
  const yDiffernce2: Int64 = y.sub(y1);

  const firstProduct: Int64 = xDifference1.mul(yDiffernce2)
  const secondProduct: Int64 = xDifference2.mul(yDiffernce1)
  const onLine = Provable.equal(
    firstProduct,
    secondProduct,
  );

  return withinXBounds.and(withinYBounds).and(onLine);
  
}

function isPointIn3PointPolygon(
  point: NoncedGeographicalPoint,
  polygon: ThreePointPolygon
): Bool {
  const x: Int64 = point.point.latitude;
  const y: Int64 = point.point.longitude;

  let vertices: Array<GeographicalPoint> = [
    polygon.vertice1,
    polygon.vertice2,
    polygon.vertice3,
  ];
  let inside: Bool = Bool(false);

  const isPointOnEdge1: Bool = isPointOnEdgeProvable(point, polygon.vertice1, polygon.vertice2);
  const isPointOnEdge2: Bool = isPointOnEdgeProvable(point, polygon.vertice2, polygon.vertice3);
  const isPointOnEdge3: Bool = isPointOnEdgeProvable(point, polygon.vertice3, polygon.vertice1);
  const isPointLocatedOnEdge: Bool = isPointOnEdge1.or(isPointOnEdge2).or(isPointOnEdge3);

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi: Int64 = vertices[i].latitude;
    const yi: Int64 = vertices[i].longitude;
    const xj: Int64 = vertices[j].latitude;
    const yj: Int64 = vertices[j].longitude;


    const condition1: Bool = Int64Prover.provableIsInt64XGreaterThanY(yi, y);
    const condition2: Bool = Int64Prover.provableIsInt64XGreaterThanY(yj, y);

    const jointCondition1: Bool = Provable.if(
      condition1.equals(condition2),
      Bool(true),
      Bool(false)
    ).not();

    Provable.log('xj:', xj);
    Provable.log('xi:', xi);
    Provable.log('yj:', yj);
    Provable.log('yi:', yi);

    const leftOperand: Int64 = xj.sub(xi);
    const rightOperand: Int64 = y.sub(yi);
    Provable.log('xj.sub(xi):', leftOperand, leftOperand.magnitude, leftOperand.sgn);
    Provable.log('y.sub(yi):', rightOperand, rightOperand.magnitude, rightOperand.sgn);

    const magnitudeProduct: UInt64 = leftOperand.magnitude.mul(rightOperand.magnitude);
    const signProduct: Sign = leftOperand.sgn.mul(rightOperand.sgn); 

    Provable.log('magnitudeProduct:', magnitudeProduct);
    Provable.log('signProduct:', signProduct, signProduct.value, signProduct.isPositive());

    const numerator: Int64 = leftOperand.mul(rightOperand);
   
    Provable.log('numerator: ', numerator);
    let denominator: Int64 = yj.sub(yi);
    Provable.log('denominator: ', denominator);  


    // Horizontal Edge case: ensure that division by zero does not occur
    const isHorizontalEdge: Bool = Int64Prover.provableIsInt64XEqualToZero(denominator);
    denominator = Provable.if(isHorizontalEdge, Int64.one, denominator);


    const result_before_addition: Int64 = numerator.div(denominator);
    const result: Int64 = result_before_addition.add(xi);

    let jointCondition2: Bool = Int64Prover.provableIsInt64XLessThanY(x, result);
    // Horizontal Edge case: this will skip the horizontal edge checks
    jointCondition2 = Provable.if(isHorizontalEdge, Bool(false), jointCondition2);

    const isIntersect: Bool = Provable.if(
      jointCondition1.and(jointCondition2),
      Bool(true),
      Bool(false)
    ); 
    inside = Provable.if(isIntersect, inside.not(), inside);
    
    Provable.log('------------------')
    Provable.log('i: ', i, ' j: ', j);
    Provable.log('x: ', x, ' y: ', y, 'result: ', result, ' inside: ', inside);
    Provable.log('jointCondition1: ', jointCondition1);
    Provable.log('jointCondition2: ', jointCondition2);
    Provable.log('isIntersect: ', isIntersect);
    Provable.log('------------------');
  }

  inside = Provable.if(isPointLocatedOnEdge, Bool(true), inside);

  return inside;
}

function proveCoordinatesIn3PointPolygon(
  point: NoncedGeographicalPoint,
  polygon: ThreePointPolygon
): CoordinateProofState {
  // TODO: IT IS CRUCIAL TO VERIFY THAT THE FACTOR OF THE POINT IS THE SAME
  // AS THE FACTOR OF ALL OF THE POINTS OF THE POLYGON. Oterwise, the math
  // will fail. Consider implementing this check as another proof.
  // The argument could be a proof that returns a struct that contains both
  // of the values provided as arguments. That proof should also validate
  // that the provided latitude and longitude values are within the accepted
  // values.
  Provable.log('Proving that point is in polygon...');
  const isInPolygon: Bool = isPointIn3PointPolygon(point, polygon);

  Provable.log('Is in Polygon ', isInPolygon);

  // If point in polygon, return the commitment data
  const polygonCommitment = polygon.hash();
  const coordinatesCommitment = point.hash();

  Provable.log('Polygon Commitment: ', polygonCommitment);
  Provable.log('Coordinates Commitment: ', coordinatesCommitment);
  Provable.log('Is In Polygon: ', isInPolygon);

  return new CoordinateProofState({
    polygonCommitment: polygonCommitment,
    coordinatesCommitment: coordinatesCommitment,
    isInPolygon: isInPolygon,
  });
}

/**
 * Given two proofs, it combines them into a single proof that is the AND of the two proofs.
 * The AND operand is applied to the `isInPolygon` field of the two proofs. The proof is computed
 * even if neither of the proofs have `isInPolygon` set to true. The proof verifies that the
 * `coordinatesCommitment` are the same, and that the `polygonCommitment` are different.
 * @param proof1 - the first proof
 * @param proof2  - the second proof
 * @returns CoordinateProofState
 */
function AND(
  proof1: SelfProof<Empty, CoordinateProofState>,
  proof2: SelfProof<Empty, CoordinateProofState>
): CoordinateProofState {
  // IMPORTANT: this has an issue. If I give proof1, which asserts that the user is in Spain, and proof2 that
  // asserts that the user is not in Romania, then the resulting proof from .AND will say that the user is
  // neither in Spain, nor Romania. This is because the AND operation is applied to the `isInPolygon` field
  // of the two proofs. This is not the desired behaviour. The desired behaviour is to have a proof that
  // asserts that the user is in Spain AND is not in Romania.

  // For correctness, this method/proof should opearate ensuring that the values of `isInPolygon` is the same
  // in both proofs: either both are true, or both are false. If they are different, then the proof should
  // fail. This way the proof will attest to either the user being inside a set of polygons, or outside of that set.

  // A good solution for this appears to be to separate proofs. The proofs in CoordinatesInPolygon should only attest to
  // either the presence or the abcense of the user from a polygon, or a set of polygons. Simple polygons are combined
  // into more complex shapes using the AND and OR operations. There should be another ZKProgram, that takes as input
  // a set of proofs from CoordinatesInPolygon ZKProgram, checks their isInPolygon values, and then combines them
  // into another proof whose public output includes a commitment to the polygons in which the user is in, and
  // to the polygons in which the user is not. Wether this should be implemented or not should be carefully considered.
  // It's important to note, that the existing system can be combined to achieve the same result, but it may not be as
  // convenient as having a single proof that attests to the presence or absence of the user from a set of polygons.
  // Proving that you are in Romania or Spain, means proving that you are NOT in the rest of the world.

  // The additional ZKProgram described above can be implemented as an additional feature. It can be considered
  // as a nice to have. The new ZKProgram would accept two proofs which have CoordinateProofState as their public output,
  // and combine them into a public output which whould add all of the `isInPolygon=True` polygons to `insidePolygonCommitment`,
  // and all of the `isInPolygon=False` polygons to `outsidePolygonCommitment`. The new ZKProgram would also verify that
  // the `coordinatesCommitment` of the two proofs are the same, and that the `polygonCommitment` are different.

  proof1.verify();
  proof2.verify();

  // ensure that the proof is for the same coordinates
  proof1.publicOutput.coordinatesCommitment.assertEquals(
    proof2.publicOutput.coordinatesCommitment
  );

  // ensure that the proof is not done for the same polygon
  proof1.publicOutput.polygonCommitment.assertNotEquals(
    proof2.publicOutput.polygonCommitment
  );

  // ensure that the proofs are either both for isInPolygon, or both not for isInPolygon
  let expectedSecondProofIsInPolygon = Provable.if(
    proof1.publicOutput.isInPolygon,
    Bool(true),
    Bool(false)
  );

  return new CoordinateProofState({
    polygonCommitment: Poseidon.hash([
      proof1.publicOutput.polygonCommitment,
      proof2.publicOutput.polygonCommitment,
    ]),
    coordinatesCommitment: proof1.publicOutput.coordinatesCommitment,
    isInPolygon: expectedSecondProofIsInPolygon,
  });
}

/**
 * Given two proofs, it combines them into a single proof that is the OR of the two proofs.
 * The OR operand is applied to the `isInPolygon` field of the two proofs. The proof is computed
 * even if neither of the proofs have `isInPolygon` set to true. The proof verifies that the
 * `coordinatesCommitment` are the same, and that the `polygonCommitment` are different.
 * @param proof1 - the first proof
 * @param proof2 - the second proof
 * @returns CoordinateProofState
 */
function OR(
  proof1: SelfProof<Empty, CoordinateProofState>,
  proof2: SelfProof<Empty, CoordinateProofState>
): CoordinateProofState {
  proof1.verify();
  proof2.verify();

  // ensure that the proof is for the same coordinates
  proof1.publicOutput.coordinatesCommitment.assertEquals(
    proof2.publicOutput.coordinatesCommitment
  );
  // ensure that the proof is not done for the same polygon
  proof1.publicOutput.polygonCommitment.assertNotEquals(
    proof2.publicOutput.polygonCommitment
  );

  // logic of OR
  let isInPolygon = Provable.if(
    proof1.publicOutput.isInPolygon.or(proof2.publicOutput.isInPolygon),
    Bool(true),
    Bool(false)
  );

  return new CoordinateProofState({
    polygonCommitment: Poseidon.hash([
      proof1.publicOutput.polygonCommitment,
      proof2.publicOutput.polygonCommitment,
    ]),
    coordinatesCommitment: proof1.publicOutput.coordinatesCommitment,
    isInPolygon: isInPolygon,
  });
}

export const CoordinatesInPolygon = Experimental.ZkProgram({
  publicOutput: CoordinateProofState,

  methods: {
    proveCoordinatesIn3PointPolygon: {
      privateInputs: [NoncedGeographicalPoint, ThreePointPolygon],
      method: proveCoordinatesIn3PointPolygon,
    },

    AND: {
      privateInputs: [
        SelfProof<Empty, CoordinateProofState>,
        SelfProof<Empty, CoordinateProofState>,
      ],
      method: AND,
    },

    OR: {
      privateInputs: [
        SelfProof<Empty, CoordinateProofState>,
        SelfProof<Empty, CoordinateProofState>,
      ],
      method: OR,
    },
  },
});

function fromCoordinatesInPolygonProof(
  proof: SelfProof<Empty, CoordinateProofState>
): CoordinatePolygonInclusionExclusionProof {
  proof.verify();

  const coodinatesInPolygonProof: CoordinateProofState = proof.publicOutput;
  const insideCommitment = Provable.if(
    coodinatesInPolygonProof.isInPolygon,
    coodinatesInPolygonProof.polygonCommitment,
    Field(0)
  );
  const outsideCommitment = Provable.if(
    coodinatesInPolygonProof.isInPolygon,
    Field(0),
    coodinatesInPolygonProof.polygonCommitment
  );

  return new CoordinatePolygonInclusionExclusionProof({
    insidePolygonCommitment: insideCommitment,
    outsidePolygonCommitment: outsideCommitment,
    coordinatesCommitment: coodinatesInPolygonProof.coordinatesCommitment,
  });
}

function combine(
  proof1: SelfProof<Empty, CoordinatePolygonInclusionExclusionProof>,
  proof2: SelfProof<Empty, CoordinatePolygonInclusionExclusionProof>
): CoordinatePolygonInclusionExclusionProof {
  proof1.verify();
  proof2.verify();

  const proof1PublicOutput: CoordinatePolygonInclusionExclusionProof =
    proof1.publicOutput;
  const proof2PublicOutput: CoordinatePolygonInclusionExclusionProof =
    proof2.publicOutput;

  // ensure that the proof is for the same coordinates
  proof1.publicOutput.coordinatesCommitment.assertEquals(
    proof2.publicOutput.coordinatesCommitment
  );

  // Ensure that we are not combining identical proofs. An identical proof
  // is a proof that commits to the samae inside and outside polygon commitments
  const isInsidePolygonCommitmentEqual: Bool = Provable.if(
    proof1PublicOutput.insidePolygonCommitment.equals(
      proof2PublicOutput.insidePolygonCommitment
    ),
    Bool(true),
    Bool(false)
  );
  const isOutsidePolygonCommitmentEqual: Bool = Provable.if(
    proof1PublicOutput.outsidePolygonCommitment.equals(
      proof2PublicOutput.outsidePolygonCommitment
    ),
    Bool(true),
    Bool(false)
  );

  // this will only fail the assertion, if both, the inside and outside polygon commitments are equal
  isInsidePolygonCommitmentEqual
    .and(isOutsidePolygonCommitmentEqual)
    .assertEquals(Bool(false));

  const isInsideCommitmentPresentInProof1: Bool = Provable.if(
    proof1PublicOutput.insidePolygonCommitment.equals(Field(0)),
    Bool(false),
    Bool(true)
  );
  const isInsideCommitmentPresentInProof2: Bool = Provable.if(
    proof2PublicOutput.insidePolygonCommitment.equals(Field(0)),
    Bool(false),
    Bool(true)
  );
  const isOutsideCommitmentPresentInProof1: Bool = Provable.if(
    proof1PublicOutput.outsidePolygonCommitment.equals(Field(0)),
    Bool(false),
    Bool(true)
  );
  const isOutsideCommitmentPresentInProof2: Bool = Provable.if(
    proof2PublicOutput.outsidePolygonCommitment.equals(Field(0)),
    Bool(false),
    Bool(true)
  );

  // Inside commitments of Proof1 and Proof2 should only be combined if they're non-zero. Here is how the value of the combined inside commitment is calculated:
  // * Proof1's and Proof2's inside commitments are non-Field(0): Poseidon.hash([Proof1, Proof2])
  // * Proof1==Field(0) and Proof2!=Field(0): Proof2
  // * Proof1!=Field(0) and Proof2==Field(0): Proof1
  // * Proof1==Field(0) and Proof2==Field(0): Field(0)

  // First, compute the joint hash, in case both of the fields are provided
  const newInsideCommitmentBothPresent: Field = Poseidon.hash([
    proof1PublicOutput.insidePolygonCommitment,
    proof2PublicOutput.insidePolygonCommitment,
  ]);

  // Now, iteratively build up ot the final hash. The idea is to start with an assumption that both proofs were provided. After that,
  // we ensure that hte assumption is correct by verifying the other conditions. The answer is only altered if one of the
  // conditions sets a new reality.
  // 1. If only proof1 is present, set to the value of proof1, otherwise, joint proof
  let newInsideCommitment = Provable.if(
    isInsideCommitmentPresentInProof1.and(
      isInsideCommitmentPresentInProof2.not()
    ),
    proof1PublicOutput.insidePolygonCommitment,
    newInsideCommitmentBothPresent
  );
  // 2. Only change the value of the commitment if proof1 is not presen and proof2 is present
  newInsideCommitment = Provable.if(
    isInsideCommitmentPresentInProof1
      .not()
      .and(isInsideCommitmentPresentInProof2),
    proof2PublicOutput.insidePolygonCommitment,
    newInsideCommitment
  );
  // 3. Only set the commitemnt explicitly to Field(0) if neither proof1, nor proof2 were provided
  newInsideCommitment = Provable.if(
    isInsideCommitmentPresentInProof1
      .not()
      .and(isInsideCommitmentPresentInProof2.not()),
    Field(0),
    newInsideCommitment
  );

  const newOutsideCommitmentBothPresent: Field = Poseidon.hash([
    proof1PublicOutput.outsidePolygonCommitment,
    proof2PublicOutput.outsidePolygonCommitment,
  ]);

  let newOutsideCommitment: Field = Provable.if(
    isOutsideCommitmentPresentInProof1.and(
      isOutsideCommitmentPresentInProof2.not()
    ),
    proof1PublicOutput.outsidePolygonCommitment,
    newOutsideCommitmentBothPresent
  );
  newOutsideCommitment = Provable.if(
    isOutsideCommitmentPresentInProof1
      .not()
      .and(isInsideCommitmentPresentInProof2),
    proof2PublicOutput.outsidePolygonCommitment,
    newOutsideCommitment
  );
  newInsideCommitment = Provable.if(
    isInsideCommitmentPresentInProof1
      .not()
      .and(isInsideCommitmentPresentInProof2.not()),
    Field(0),
    newOutsideCommitment
  );

  return new CoordinatePolygonInclusionExclusionProof({
    insidePolygonCommitment: newInsideCommitment,
    outsidePolygonCommitment: newOutsideCommitment,
    coordinatesCommitment: proof1PublicOutput.coordinatesCommitment,
  });
}

export const CoordinatesInOrOutOfPolygon = Experimental.ZkProgram({
  publicOutput: CoordinatePolygonInclusionExclusionProof,

  methods: {
    fromCoordinatesInPolygonProof: {
      privateInputs: [SelfProof<Empty, CoordinateProofState>],
      method: fromCoordinatesInPolygonProof,
    },
    combine: {
      privateInputs: [
        SelfProof<Empty, CoordinatePolygonInclusionExclusionProof>,
        SelfProof<Empty, CoordinatePolygonInclusionExclusionProof>,
      ],
      method: combine,
    },
  },
});

/**
 * Represents the history of locations. The history of locations is composed of proofs from `LocationInPolygon`.
 * All of the histoircal data and assertions about the lcoation are performed here.
 *
 * This is a "public" proof, meaning it is stored on the blockchain.
 */
export class LocationHistorySC extends SmartContract {
  @state(Field) merkleRoot = State<Field>();

  @method init() {
    super.init();
    this.merkleRoot.set(Field(0));
  }
}
