/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
var PhpDocParser;
(function (PhpDocParser) {
    const stripPattern = /^\/\*\*\s*|\s*\*\/$|^[ \t]*\*[ \t]*/mg;
    const tagBoundaryPattern = /(?:\r\n|\r|\n)(?=@)/;
    const summaryBoundaryPattern = /\.(?:\r\n|\r|\n)|(?:\r\n|\r|\n){2}/;
    const methodParamPartBoundaryPattern = /\s*,\s*|\s+/;
    const tagPattern = new RegExp([
        /^(@param|@var|@property|@property-read|@property-write|@return|@throws)\s+(\S+)\s+(\$\S+)?\s*([^]*)$/.source,
        /^(@method)\s+(\S+\s+)?(\S+)\(\s*([^]*)\s*\)(?!\[)\s*([^]*)$/.source
    ].join('|'));
    function parse(input) {
        if (!input) {
            return null;
        }
        let stripped = input.replace(stripPattern, '');
        let split = stripped.split(tagBoundaryPattern);
        let text = null;
        if (split[0] && split[0][0] !== '@') {
            text = split.shift();
        }
        let match;
        let tagString;
        let tags = [];
        let tag;
        while (tagString = split.shift()) {
            //parse @param, @var, @property*, @return, @throws, @method tags
            if (!(match = tagString.match(tagPattern))) {
                continue;
            }
            if (match[1]) {
                tags.push(typeTag(match[1], match[2], match[3], match[4]));
            }
            else {
                tags.push(methodTag(match[5], match[6], match[7], methodParameters(match[8]), match[9]));
            }
            tags.push(tag);
        }
        //must have at least text or a tag
        if (!text && !tags.length) {
            return null;
        }
        return new PhpDoc(text, tags);
    }
    PhpDocParser.parse = parse;
    function typeTag(tagName, typeString, name, description) {
        return {
            tagName: tagName,
            typeString: typeString,
            name: name ? name : '',
            description: description ? description : ''
        };
    }
    function methodTag(tagName, returnTypeString, name, parameters, description) {
        return {
            tagName: tagName,
            typeString: returnTypeString ? returnTypeString : 'void',
            name: name,
            parameters: parameters,
            description: description ? description : ''
        };
    }
    function methodParameters(input) {
        if (!input) {
            return [];
        }
        let params = [];
        let paramSplit = input.split(methodParamPartBoundaryPattern);
        let typeString, name;
        while (paramSplit.length) {
            name = paramSplit.pop();
            typeString = paramSplit.pop();
            if (name && typeString) {
                params.push({
                    typeString: typeString,
                    name: name
                });
            }
        }
        return params.reverse();
    }
})(PhpDocParser = exports.PhpDocParser || (exports.PhpDocParser = {}));
class PhpDoc {
    constructor(text, tags) {
        this.text = text;
        this.tags = tags;
    }
    get returnTag() {
        return this.tags.find(PhpDoc.isReturnTag);
    }
    get propertyTags() {
        return this.tags.filter(PhpDoc.isPropertyTag);
    }
    get methodTags() {
        return this.tags.filter(PhpDoc.isMethodTag);
    }
    findParamTag(name) {
        let fn = (x) => {
            return x.tagName === '@param' && x.name === name;
        };
        return this.tags.find(fn);
    }
    findVarTag(name) {
        let fn = (x) => {
            return x.tagName === '@var' && (!x.name || name === x.name);
        };
        return this.tags.find(fn);
    }
}
exports.PhpDoc = PhpDoc;
(function (PhpDoc) {
    function isPropertyTag(t) {
        return t.tagName.indexOf('@property') === 0;
    }
    PhpDoc.isPropertyTag = isPropertyTag;
    function isReturnTag(t) {
        return t.tagName === '@return';
    }
    PhpDoc.isReturnTag = isReturnTag;
    function isMethodTag(t) {
        return t.tagName === '@method';
    }
    PhpDoc.isMethodTag = isMethodTag;
})(PhpDoc = exports.PhpDoc || (exports.PhpDoc = {}));
