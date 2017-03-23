import { Phrase, Token } from 'php7parser';
export declare class ParseTree {
    uri: string;
    root: Phrase;
    constructor(uri: string, root: Phrase);
}
export declare namespace ParseTree {
    function tokenRange(node: Phrase | Token): [Token, Token];
    function firstToken(node: Phrase | Token): Token;
    function lastToken(node: Phrase | Token): Token;
}
export declare class ParseTreeStore {
    private _map;
    constructor();
    add(parseTree: ParseTree): void;
    remove(uri: string): void;
    getParsedDocument(uri: string): ParseTree;
}
