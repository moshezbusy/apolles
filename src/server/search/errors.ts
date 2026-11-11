// Errors of the search service. The UI maps each to a message (screen 24 for SearchUnavailable).
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class SearchInputInvalid extends SearchError {}
export class SearchRateLimited extends SearchError {}
export class SearchUnavailable extends SearchError {}
export class SearchExpired extends SearchError {}
