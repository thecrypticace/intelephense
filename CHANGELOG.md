# Change Log

## [0.6.5] - 2017-04-20
### Fixed
* Use directives from other files showing as completion items

## [0.6.4] - 2017-04-19
### Added
* Detail on variable and constructor completion items.
* Indexing on fqn parts.
### Fixed
* Variable types not resolving when on rhs of assignment
* Infinite recursion on cyclical inheritance
* Sort order of backslash prefixed completions

## [0.6.2] - 2017-04-18
### Added
* Tests - DefintionProvider; SignatureHelpProvider; CompletionProvider; TypeString
### Fixed
* Completion provider fixes and tweaks.
* Definition provider go to property fix.
### Dependencies
* php7parser 0.9.1

## [0.6.0] - 2017-04-17
### Added
* Document symbols provider
* Workspace symbols provider
* Type definition provider
* Signature help provider
* Diagnostics provider
* Completion provider
