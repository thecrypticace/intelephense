/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Token, PhraseType, TokenType} from 'php7parser';
import {ParsedDocument} from './parsedDocument';
import {NameResolver} from './nameResolver';

export interface NodeTransform<T> {
    phraseType?:PhraseType;
    tokenType?:TokenType;
    push?(transform: NodeTransform<any>);
    value: T;
}

export class IdentifierTransform implements NodeTransform<string> {

    phraseType = PhraseType.Identifier;
    value = '';

    push(transform: NodeTransform<any>) {
        this.value = transform.value;
    }

}

export class TokenTransform implements NodeTransform<string> {

    tokenType:TokenType;

    constructor(public doc: ParsedDocument, public token: Token) {
        this.tokenType = token.tokenType;
    }

    get value() {
        return this.doc.tokenText(this.token);
    }

}

export class NamespaceNameTransform implements NodeTransform<string> {

    phraseType = PhraseType.NamespaceName;
    value: string = '';

    push(transform: NodeTransform<any>) {
        if (transform.tokenType === TokenType.Name || transform.tokenType === TokenType.Backslash) {
            this.value += transform.value;
        }
    }

}