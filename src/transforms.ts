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

export class TokenTransform implements NodeTransform<string> {

    tokenType:TokenType;

    constructor(public doc: ParsedDocument, public token: Token) {
        this.tokenType = token.tokenType;
    }

    get value() {
        return this.doc.tokenText(this.token);
    }

}

export class QualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.QualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveNotFullyQualified(transform.value);
        }
    }

}

export class RelativeQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.RelativeQualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveRelative(transform.value);
        }
    }

}

export class FullyQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.FullyQualifiedName;

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = transform.value;
        }
    }

}


export class NamespaceNameTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceName;
    value: string = '';

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name || transform.tokenType === TokenType.Backslash) {
            this.value += transform.value;
        }
    }

}

export class DelimiteredListTransform implements NodeTransform {

    value: any[];

    constructor(public phraseType: PhraseType, public delimiter: TokenType) {
        this.value = [];
    }

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Comment:
            case TokenType.DocumentComment:
            case TokenType.Whitespace:
            case this.delimiter:
                break;
            default:
                this.value.push(transform.value);
                break;
        }
    }

}