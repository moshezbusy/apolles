# Does the applicant's country affect Expedia Rapid API approval? (independent evidence, as of 26 Nov 2026)

> Method and access limits (read first). Research was done on 26 Nov 2026. In this session direct page fetching was blocked for almost every external host (stayapi.com, zentrumhub.com, partner.expediagroup.com, developers.expediagroup.com all failed DNS; reddit.com refused the fetcher), and the web-search tool cannot crawl reddit.com or stackoverflow.com at all. Reddit and Hacker News were therefore checked only through Google result titles and snippets (about 8 Google `site:` queries), not by reading full threads. Quotes below from vendor blogs and Expedia pages are taken from search-result extracts, not from a full read of the page; treat wording as close-to-verbatim, not verified verbatim. No client details were used in any query.
>
> Headline count: independent first-hand reports that the applicant's country changed a Rapid API decision = 0 found. First-hand reports of approval after re-applying through a foreign entity = 0 found. First-hand reports of an account closed for entity misrepresentation = 0 found.

## 1. Do forums / Reddit / HN / Quora / LinkedIn etc. report that some countries are rejected more often and US/UK/EU/UAE/SG/AU entities approved more easily?

### Takeaway
No. I found zero independent first-hand posts saying that a Rapid API application was rejected (or approved) because of the applicant's country, for any country. The only "country-ish" statement anywhere is one vendor blog saying Expedia vets on "booking volume, market, and coverage", with no detail and no country named.

### Cited Findings
- [Individual first-hand, Reddit r/travelagents, about 2 years old, i.e. roughly 2024] Thread "Looking for a host agency offering online payments and ..." (8 comments): poster writes "Now I need to learn what I need for Rapid API for Expedia TAAP. I see that Viator has API's as well." Nothing about rejection or country in the visible snippet; full thread not readable. Permalink not captured (Google redirect link only) — [r/travelagents](https://www.reddit.com/r/travelagents/)
- [Individual first-hand, Reddit r/Affiliatemarketing, about 1 year old, roughly 2025] Thread "Struggling to Access Hotel Affiliate APIs" (4 comments): "I've already applied via CJ for Booking and Expedia, and directly to Agoda. But I'm feeling a bit stuck and nervous that I won't get approved". This concerns the affiliate programme via CJ, not Rapid; no country mentioned in the snippet. Permalink not captured — [r/Affiliatemarketing](https://www.reddit.com/r/Affiliatemarketing/)
- [Individual first-hand, Reddit r/SaaS and r/AskProgramming, about 1 year old] Thread "Has anyone integrated multiple OTA APIs (Booking.com, ...)": "API access — some require partner status, others have limited or no public API." No country angle in snippet. Permalink not captured — [r/SaaS](https://www.reddit.com/r/SaaS/)
- [Individual first-hand, Reddit r/Bookingcom, about 9 months old, roughly Feb 2026] Thread "Has anyone ever managed to get Booking's Demand API?" (4 comments) — about Booking.com, not Expedia; shows the same "can't get partner API" complaint exists for competitors. Permalink not captured — [r/Bookingcom](https://www.reddit.com/r/Bookingcom/)
- [Individual first-hand, Hacker News, 11 Nov 2024] In the thread "All the data can be yours: reverse engineering APIs" a commenter says "I did it with the Expedia api for a while" (reverse-engineering, not partner approval). Nothing about country. Exact item URL not captured — [Hacker News](https://news.ycombinator.com/)
- [Third-party vendor blog, opinion/marketing, StayAPI, undated in my extract, 2026-era] Expedia "vets applicants on booking volume, market, and coverage", "smaller platforms are frequently turned away", and "there's no self-serve key at any price". This is the single mention of "market" as a criterion that I found; it names no country and gives no evidence. StayAPI sells a competing data product — [StayAPI](https://stayapi.com/blog/expedia-rapid-api)
- [Third-party vendor blog, opinion/marketing, ZentrumHub, dated 17 Apr 2026 in Google results] Applicants are "reviewed on their business model and projected volume", "not all applicants are approved, and high-volume partners receive priority consideration"; rates "individually negotiated based on projected booking volume". No country criterion mentioned. ZentrumHub sells an aggregator connection to Expedia — [ZentrumHub](https://www.zentrumhub.com/blog/expedia-rapid-hotel-api-integration/)
- [Third-party vendor blog, opinion/marketing, ktemia.com, 10 Nov 2026] Article "Expedia API Alternative: Compare Without the Partner Gate" quotes Expedia's Rapid landing page: "All applications will be reviewed case by case." and says there is no "sign up and get a key". Exact article URL not captured — [ktemia.com](https://www.ktemia.com/)
- [Third-party vendor blog, opinion/marketing, Makcorps] Getting Rapid means going "through an approval process, then meet their launch requirements, and in some cases, prove that you already manage or sell a high volume of bookings" — [Makcorps](https://www.makcorps.com/blog/?p=2997)
- [Third-party vendor blog, opinion/marketing, PHPTravels] "Expedia Partner Solutions (EPS) vets each partner and only unlocks production after certification test cases are passed"; elsewhere "Expedia prioritises high-volume partners" and "IATA accreditation is not required for Expedia Rapid API access" — [PHPTravels](https://phptravels.com/expedia-api-integration); [PHPTravels supplier list](https://phptravels.com/blog/travel-api-suppliers)
- [Third-party directory, Supergood] "partner-only: application, approval, and certification, with no self-serve signup" — [Supergood](https://supergood.ai/api-report-card/expedia-affiliate-network)
- [Third-party vendor blog, AltexSoft, older EPS-era article, possibly outdated] Expedia "doesn't publicly disclose its enrollment terms, but considers things like revenue and growth potential, existing solution, website traffic, and average bookings" — no country factor listed — [AltexSoft](https://www.altexsoft.com/blog/expedia-taap-rapid-api-partner-solutions/)
- [Third-party aggregator page, weak] For India, the Expedia affiliate offering "is typically managed via third-party affiliate channels rather than a direct public affiliate portal" — affiliate programme, not Rapid — [Takeads](https://takeads.com/merchants/expedia-in/)

### Inferences
- Every independent or vendor source that explains Rapid selectivity attributes it to volume, business model and commercial fit. Country is not named as a criterion by anyone I could find. That is absence of evidence, not proof that country is irrelevant.
- The StayAPI word "market" is the only hook for a country theory, and a single unexplained word in a competitor's marketing blog cannot support a rule.
- Complaints about not getting partner APIs appear for Booking.com Demand API too, which suggests a general "small applicant" pattern rather than a nationality pattern.

### Gaps
- Full Reddit threads, Stack Overflow, Quora, Facebook groups, LinkedIn posts, YouTube comments, BlackHatWorld and Indie Hackers could not be read or searched directly from this session. A manual search on reddit.com (r/travelagents, r/startups, r/SaaS, r/webdev, r/Affiliatemarketing) by a human is still worth doing; my finding is "nothing surfaced through Google snippets", not "nothing exists".
- No post found for any of: India, Pakistan, Nigeria, Middle East, Israel, Turkey, Southeast Asia, Latin America, Eastern Europe being rejected more often.
- No independent source found that uses or explains the wording "an opening becomes available".

## 2. Are there reports of approval after applying through a company registered in another country (US LLC, UK Ltd, Estonian OU, UAE free-zone), and what happened afterwards?

### Takeaway
None found. I located no first-hand account, vendor blog or trade article describing someone who was rejected and then approved via a foreign-registered entity, nor any description of the after-effects. As a tactic it is undocumented, so it cannot be called "known and working".

### Cited Findings
- A dedicated search for travel startups using a US LLC / UK Ltd / Estonian / Dubai free-zone entity to obtain hotel API access (Expedia, Hotelbeds, Booking) returned only generic supplier comparison pages; none discuss entity jurisdiction — [PHPTravels supplier list](https://phptravels.com/blog/travel-api-suppliers); [Tripgic, 27 Oct 2026](https://www.tripgic.com/playbook/hotel-api-providers/)
- [Third-party vendor blogs] The alternative route they describe is not a foreign entity but an aggregator: "OTAs connect once and get access to Expedia alongside 100+ other suppliers without needing to negotiate directly with Expedia Partner Solutions" — [ZentrumHub](https://www.zentrumhub.com/blog/expedia-rapid-hotel-api-integration/)
- [Official Expedia, used for a hard fact only] The Rapid sign-up page reportedly states that if a business is not suitable for a direct connection, its details may be passed to Expedia's "API downstream partners", who may then contact the applicant by email about accessing Expedia Group supply (wording from search extract, page not opened) — [Expedia Group Rapid sign-up](https://partner.expediagroup.com/en-us/join-us/rapid-api)

### Inferences
- The documented fallback for declined applicants is an indirect connection (downstream partner / aggregator / TAAP), not a second application from another jurisdiction.

### Gaps
- No data on contract entity, payment, tax or point-of-sale consequences of applying via a foreign entity, because no such case was found.
- Whether Expedia treats a second application from a related entity as a new applicant or links it to the earlier rejection is unknown.

## 3. Is Rapid onboarding organised by regional teams with different capacity or thresholds, and is there independent evidence of regional waiting lists or paused onboarding?

### Takeaway
Trade press confirms Expedia's B2B arm sells through regional teams (APAC sales leadership, a UAE-based team hired in 2025), but I found no independent evidence of region-specific quotas, thresholds, waiting lists or paused Rapid lodging onboarding. The waitlists that are documented are product-based (Rapid Car beta, Rapid Activities beta), not region-based.

### Cited Findings
- [Trade press, WiT] Aileen Chan is described as VP of APAC Sales at Expedia Group B2B (Private Label Solutions); articles describe a B2B engine with "60,000+ travel partnerships" — [WiT](https://www.webintravel.com/inside-expedias-b2b-engine-powering-60000-travel-partnerships-wit-studio/)
- [Official press release via Business Wire, 23 Apr 2025] Expedia Group announced Middle East partnerships and the launch of TAAP in the UAE; other parts of its B2B network had operated in the region for 10+ years with partners Rezlive, Halalbooking and Blackrock Technologies — [Business Wire](https://www.businesswire.com/news/home/20250423970229/en/Expedia-Group-Expands-Presence-in-the-Middle-East-Through-New-Travel-Partnerships)
- [Trade press, 2025] Coverage of the UAE launch reports a team hired and based in the UAE for it, and frames the launch as a response to pent-up regional demand — [TTN](https://ttnonline.com/Article/385879/-Expedia-debuts-travel-agent-platform-in-UAE-); [Travolution](https://www.travolution.com/news/travel-sectors/travel-agents/expedia-launches-travel-agent-affiliate-programme-in-uae/)
- [Trade press] Connecting Travel dates the UAE TAAP launch to May 2025 (press release is dated 23 Apr 2025; minor date conflict) and reports later GCC-specific payment terms — [Connecting Travel](https://connectingtravel.com/news/expedia-platform-expands-payment-flexibility-for-gcc-travel-agents)
- [Trade press, 2025] Gulf Business interview with Rob Torres on Expedia's growing Middle East focus — [Gulf Business](https://gulfbusiness.com/en/2025/interviews/expedia-groups-rob-torres-on-its-regional-focus/)
- [Official Expedia, hard fact] Rapid Car API is in beta with selected partners with a waitlist, full launch expected in 2026 — [Expedia Rapid Car](https://partner.expediagroup.com/en-us/landing-pages/rapid-car-api-for-scalable-car-rental-bookings)
- [Official Expedia, hard fact] Rapid Activities API is in beta with select partners; partners can join a waitlist and "We will qualify candidates and confirm capabilities during the sales process" — [Expedia Rapid Activities](https://partner.expediagroup.com/en-us/landing-pages/make-every-trip-more-memorable-with-rapid-activities-api)
- [Trade press, Oct 2026] Curated activities in TAAP were available in beta to a limited number of UK travel agencies, i.e. one documented case of a market-limited rollout, but for a beta feature in TAAP — [Travolution](https://www.travolution.com/en/article/expedia-taap-launches-beta-rapid-activities-api-for-agencies)
- [Third-party blog, unverified] StayAPI says Expedia paused new Travel Redirect API applications because of request volume. Different product from Rapid — [StayAPI](https://stayapi.com/blog/expedia-rapid-api)

### Inferences
- A regional sales structure makes it plausible that account-manager capacity differs by region, and "an opening becomes available" is consistent with capacity-limited onboarding. This is inference only; no source states it.
- Programmes are launched market by market (TAAP reached the UAE only in 2025), so availability of Expedia B2B products does vary by country at programme level. No source shows this for Rapid lodging.

### Gaps
- No independent evidence of regional thresholds, regional waitlists or a paused Rapid lodging intake in any market.
- Which Expedia B2B sales team covers Israel (EMEA, Middle East, or other) was not found.

## 4. Israel specifically: Israeli Rapid partners, regional coverage, reports of Israeli applicants declined or redirected

### Takeaway
No report of an Israeli applicant being declined or redirected was found, and nothing suggests Israel is an excluded market. An Israeli-founded company (Arbitrip) appears on Expedia's own Rapid partner list, and Expedia TAAP has had Israeli representation since 2013 according to an Israeli trade site. Independent evidence on Israel is otherwise very thin.

### Cited Findings
- [Official Expedia, hard fact] Arbitrip is shown among Rapid API / travel-agency partner logos alongside HotelPlanner, Navan and Spotnana — [Expedia Rapid API page](https://partner.expediagroup.com/en-us/solutions/build-your-travel-experience/rapid-api); [Expedia travel agencies page](https://partner.expediagroup.com/en-us/industries/travel-agencies)
- [Trade press] Arbitrip is described as an Israeli start-up — [Travolution](https://www.travolution.com/news/travel-sectors/corporate-travel/israeli-start-up-arbitrip-makes-play-for-the-millennial-corporate/); [CTech](https://www.calcalistech.com/ctech/articles/0,7340,L-3763388,00.html)
- [Israeli trade site, 2013, EAN/EPS era, possibly outdated] "Expedia TAAP now also in Israel": from 1 July 2013 Discover the World Marketing Israel represented the TAAP programme for Israeli travel agents — [IAS](https://www.ias.co.il/%D7%AA%D7%A2%D7%95%D7%A4%D7%94/expedia-taap-%D7%9E%D7%A2%D7%AA%D7%94-%D7%92%D7%9D-%D7%91%D7%99%D7%A9%D7%A8%D7%90%D7%9C/)
- [Press, roughly 20 years old, outdated] Expedia partnered with Israeli tour operator IGT to launch an Israeli section of its site — [Jerusalem Post](https://www.jpost.com/Travel/Travel-News/Expedia-to-launch-Israeli-travel-site)
- [Israeli press, 2025] Hebrew coverage of Expedia's April 2025 Middle East expansion (TAAP in UAE; Rezlive, Halalbooking, Blackrock Technologies) does not mention Israel — [News-Plus](https://www.news-plus.co.il/%D7%9B%D7%9C%D7%9B%D7%9C%D7%94/expedia-group-2604/)
- [Press] Israeli start-up Splitty combines rate plans "from multiple travel wholesalers and online travel agencies – like Expedia and Kayak" (does not confirm a Rapid contract) — [Jerusalem Post](https://www.jpost.com/jpost-tech/start-up-hacks-reservations-offering-bargains-539637)
- [Official Expedia, hard fact] Rapid's only named unsupported points of sale in the extract I obtained are Cuba and Syria; Israel is not listed — [Expedia Developer Hub, lodging launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/lodging-launch-reqs)

### Inferences
- Arbitrip's presence shows that being Israeli in origin does not by itself bar a Rapid partnership. It does not show which legal entity signed (Israeli or foreign), nor does it say anything about a small agency's chances; Arbitrip is a funded corporate-travel platform.
- TAAP (agent portal, no API) appears to be the Expedia product with an established Israeli channel; that is the likely redirect for an agency without scale.

### Gaps
- Which Arbitrip legal entity holds the Rapid contract: not found.
- No other Israeli Rapid contract holder confirmed by an independent source (Issta, Gulliver, Eshet Tours, Hotelmize, Travelier: nothing found).
- Whether Discover the World still represents TAAP in Israel in 2026, and who the current Israel contact is: not found.
- No first-hand Israeli account of a Rapid application, in English or Hebrew.

## 5. Country-dependent point-of-sale, currency, tax or legal restrictions in Rapid

### Takeaway
The documented geographic restrictions concern where the traveller is sold to (point of sale), not where the partner company is registered. The only named exclusions I found are Cuba and Syria. I found no published list of countries whose companies Expedia will or will not contract with for Rapid.

### Cited Findings
- [Official Expedia, hard fact] "Rapid does not support bookings, directly or indirectly, made on any of the following points of sale: Cuba · Syria" (from search extract of Developer Hub launch-requirement pages; exact page not opened) — [Lodging launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/lodging-launch-reqs)
- [Official Expedia, hard fact] Shopping requests must carry the country code matching the point of sale used by the customer — [Lodging launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/lodging-launch-reqs)
- [Official Expedia, hard fact] Vrbo on Rapid: the country code in the shopping request must match the billing country of the card; billing currency always matches the property's currency — [Vrbo launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/vrbo-launch-requirements)
- [Official Expedia, hard fact] Rapid publishes a table of supported currencies per product (lodging list is broad: ARS, BRL, CNY, INR, MXN, ZAR etc.; car list narrower). Whether ILS is included was not visible in my extract — [Locale details](https://developers.expediagroup.com/rapid/resources/locale-details)
- [Official Expedia, hard fact] Since Dec 2025 Rapid lets partners submit clarifying traveller details when a traveller's name matches a government sanctions list. This is guest screening, not partner screening — [Rapid changelog](https://developers.expediagroup.com/rapid/setup/changelog)
- [Official Expedia, hard fact] Invoicing depends on payment model (Property Collect: property issues tax invoice; Expedia Collect: at property's discretion) — [Rapid booking receipts](https://developers.expediagroup.com/rapid/lodging/manage-booking/booking-receipts?locale=en_US)
- [Official Expedia, different programme, indicative only] Expedia's supply-side Connectivity API licence makes the partner solely responsible for taxes and uses US forms W-9 / W-8BEN-E / W-8ECI, i.e. it anticipates non-US contracting parties. This is not the Rapid demand agreement — [Connectivity API License Agreement](https://developers.expediagroup.com/supply/lodging/license)
- [Third-party vendor blog] Expedia's "strongest coverage is in North America and Europe, with solid presence across APAC and the Middle East" (about hotel inventory, not partner eligibility) — [ZentrumHub](https://www.zentrumhub.com/blog/expedia-rapid-hotel-api-integration/)

### Inferences
- Since restrictions are framed around point of sale, the country a partner sells into is probably more relevant to Expedia than the country of incorporation. The Rapid agreement itself was not seen, so this is inference.

### Gaps
- The Rapid partner agreement is not public; contracting Expedia entity per region, required partner legal form, billing currency and tax treatment (VAT, withholding) for an Israeli versus foreign entity could not be established from any source, official or independent.
- "Expedia Travel Partner Services, LLC" surfaced only as a Google related-search suggestion; I could not confirm its role.
- No integrator blog describes country-of-partner restrictions.

## 6. What do integrators and consultants advise about choosing the applying entity and country? (vendor opinion)

### Takeaway
None of the vendor blogs I found gives any advice about which country or entity to apply from. Their consistent advice, which is self-interested, is that small applicants should connect to Expedia inventory through an aggregator or use TAAP instead of applying directly.

### Cited Findings
- [Vendor opinion, sells the alternative] Use an aggregator to reach Expedia "without needing to negotiate directly with Expedia Partner Solutions" — [ZentrumHub](https://www.zentrumhub.com/blog/expedia-rapid-hotel-api-integration/)
- [Vendor opinion, sells the alternative] "smaller platforms are frequently turned away"; enrollment, contract negotiation and connection "can take several months" — [StayAPI](https://stayapi.com/blog/expedia-rapid-api)
- [Vendor opinion] Eligible types listed as OTAs, white-label platforms, airline loyalty portals, corporate booking tools and financial-services travel programmes; individual developers and non-travel businesses do not qualify (attribution to a specific blog uncertain; surfaced in a search over ZentrumHub / PHPTravels / AltexSoft pages) — [ZentrumHub overview](https://www.zentrumhub.com/expedia-hotel-api/)
- [Vendor opinion] For startups, Hotelbeds ("free API key and evaluation plan, then certification") and RateHawk ("free API key after registration") are presented as more accessible than Expedia — [PHPTravels](https://phptravels.com/blog/travel-api-suppliers)
- [Official Expedia, hard fact] Expedia itself points partners without resources, or not connecting directly, to its certified technology partners — [Expedia technology partners](https://partner.expediagroup.com/en-us/solutions/build-your-travel-experience/rapid-api/certified-technology-partners-program)

### Inferences
- The absence of any "apply from country X" advice in a crowded field of SEO-driven vendor blogs suggests it is not a recognised lever in the trade. Weak inference from silence.

### Gaps
- No consultant, lawyer or integrator source addressing entity choice for Rapid was found.

## 7. Risks: does applying via a shell entity in another country breach Expedia terms or create misrepresentation risk? Any first-hand accounts of closures?

### Takeaway
No first-hand account of a Rapid account closed for applying through a shell or foreign entity was found, and I could not see Rapid's contract terms on misrepresentation. The risk can therefore be neither confirmed nor ruled out from public sources.

### Cited Findings
- [Official Expedia, different API product, indicative only] Expedia's XAP API terms reserve "the right to remove access to our API in the event that you do not comply with rules, regulations or policies" — [XAP API terms](https://developers.expediagroup.com/xap-apis/api/resources/terms-and-conditions)
- [Official Expedia, hard fact] Technology partners are tiered and "regularly" reviewed on business metrics and integration quality, so partners are re-assessed after onboarding — [Expedia technology partners](https://partner.expediagroup.com/en-us/solutions/build-your-travel-experience/rapid-api/certified-technology-partners-program)
- [Official Expedia, hard fact] B2B launch requirements oblige downstream agents to accept Expedia's agent terms, so who actually sells through a connection is contractually controlled — [B2B standalone launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/b2b-standalone)
- A search for Rapid partner KYC, legal-entity verification, sanctions screening of partners or termination for misrepresentation returned no public material — [Expedia Rapid sign-up](https://partner.expediagroup.com/en-us/join-us/rapid-api)

### Inferences
- Commercial agreements of this kind normally require accurate information about the contracting party and its sales channels; an entity with no real operations, fronting for a business Expedia already declined, would plausibly be a misrepresentation. This is general reasoning, not something found in an Expedia document.
- Because every source ties selectivity to volume and business model, a new shell with no trading history would likely look weaker on those criteria, not stronger. Inference only.

### Gaps
- Rapid partner agreement text (warranties, change-of-control, termination) not public and not seen.
- No first-hand account of closure, clawback or blacklisting connected to entity or country misrepresentation.
