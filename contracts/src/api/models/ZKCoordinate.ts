import { InputNumber } from "../Types";
import { ZKNumber } from "./ZKNumber";

/*
 Represents a coordinate that will be converted to the Fields of a zkSNARK in zkLocus.

    It imposes the maximum and the minimum possible values for a coordinate, wether it's latitude or longitude, and
    ensures that the precision limit is not exceeded.
*/


export class ZKCoordinate extends ZKNumber {
    MAX_FACTOR: number = 10 ** 7;
    constructor(value: InputNumber) {
        super(value);
        if (this.factor > this.MAX_FACTOR) {
            throw new Error(`Invalid factor. The maximum factor is 7. The provided value is ${this.factor}`);
        }
    }
}
