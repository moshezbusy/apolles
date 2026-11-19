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

// Plan 10: more than one room while the real supplier is on (see multiRoomAllowed).
export const SEVERAL_ROOMS_UNAVAILABLE = "Several rooms are not available yet.";
