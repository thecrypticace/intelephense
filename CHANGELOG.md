# Change Log

## [0.6.7] - 2017-04-21
### Dependencies 
* php7parser 0.9.2

## [0.6.6] - 2017-04-21
### Added 
* Sorting of fuzzy symbol matches

### Fixed
* Diagnostics being reported on wrong file.
* Document becoming out of sync when applying multiple changes
* Variable types not resolving in various contexts.

## [0.6.5] - 2017-04-20
### Changed
* Shortened name completion item labels to name without namespace prefix.
* Shortened method override/implementation completion labels to just method name.
* Reduced completion spam for extends and implements contexts.
* Rolled back indexing on fqn parts.

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
