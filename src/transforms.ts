/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Phrase, Token, PhraseType, TokenType } from 'php7parser';
import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';



export class IdentifierTransform implements NodeTransform {

    text = '';
    constructor(public node: Phrase | Token) { }

    push(transform: NodeTransform) {
        this.text = (<TokenTransform>transform).text;
    }

}

