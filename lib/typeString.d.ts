import { NameResolver } from './nameResolver';
export declare namespace TypeString {
    function atomicClassArray(typeString: string): string[];
    function arrayDereference(typeString: string): string;
    function array(typeString: string): string;
    function merge(a: string, b: string): string;
    function nameResolve(typeString: string, nameResolver: NameResolver): string;
}
