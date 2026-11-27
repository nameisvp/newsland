import unittest
from server import assess_story, group, timestamp, clean
class CollectorTests(unittest.TestCase):
    def story(self,title,source='A'):
        return {'title':title,'region':'India','score':4,'published':1,'sources':[{'name':source,'url':'https://example.com/'+source}]}
    def test_duplicate_group(self):
        items=group([self.story('RBI keeps repo rate unchanged at 5.5%'),self.story('RBI keeps repo rate unchanged at 5.5%','B')])
        self.assertEqual(len(items),1);self.assertEqual(len(items[0]['sources']),2)
    def test_numeric_changes_stay_separate(self):
        self.assertEqual(len(group([self.story('RBI repo rate 5.5%'),self.story('RBI repo rate 5.0%')])),2)
    def test_invalid_date_not_assumed_fresh(self):
        self.assertIsNone(timestamp('unknown'))
    def test_timezone_dates(self):
        self.assertEqual(timestamp('2026-10-05T10:00:00+05:30'),timestamp('Mon, 05 Oct 2026 04:30:00 GMT'))
    def test_markup_removed(self):
        self.assertEqual(clean('<b>RBI</b> &amp; banks'), 'RBI & banks')
    def test_material_rbi_decision_is_high_priority(self):
        item = assess_story('RBI keeps repo rate unchanged', 'India', official=True)
        self.assertEqual(item['tier'], 'Must know')
        self.assertIn('Monetary policy', item['matched'])
    def test_india_linked_global_macro_data_is_watchlisted(self):
        item = assess_story('US jobs data falls, dollar weakens against rupee', 'Global')
        self.assertEqual(item['tier'], 'Must know')
        self.assertIn('Economic data', item['matched'])
        self.assertIn('Market flows', item['matched'])
    def test_specific_company_results_are_watch_level(self):
        item = assess_story('HDFC Bank quarterly results show profit rises 12%', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertIn('Earnings', item['matched'])
    def test_non_market_entertainment_is_lower_signal(self):
        item = assess_story('The Paradise box office collection day 11: film gains momentum', 'India')
        self.assertEqual(item['tier'], 'More')
        self.assertEqual(item['score'], 0)
    def test_generic_non_market_headline_is_not_promoted(self):
        item = assess_story('India economy strong; energy security, jobs key to growth', 'India')
        self.assertEqual(item['tier'], 'More')
    def test_peripheral_european_data_is_not_a_top_india_driver(self):
        item = assess_story('Italy services growth slows in September as costs rise, PMI shows', 'Global')
        self.assertEqual(item['tier'], 'More')
    def test_large_global_company_results_remain_visible(self):
        item = assess_story('Accenture results beat estimates as revenue rises', 'Global')
        self.assertEqual(item['tier'], 'Watch')
    def test_indian_it_sector_impact_from_accenture_remains_visible(self):
        item = assess_story("Accenture's growth beat sparks rally, but outlook for Indian IT is mixed", 'India')
        self.assertEqual(item['tier'], 'Watch')
    def test_unrelated_overseas_single_stock_move_stays_lower_signal(self):
        item = assess_story('Ithaca Energy shares rise 3% on Canadian asset deal', 'Global')
        self.assertEqual(item['tier'], 'More')
    def test_india_share_price_shock_is_retained_as_a_driver(self):
        item = assess_story('ESDS Software shares hit lower circuit, crash nearly 30%', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Company move')
    def test_material_indian_order_is_retained(self):
        item = assess_story('L&T wins ₹10,000 crore orders for power transmission business', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Company move')
    def test_india_trade_policy_news_is_retained(self):
        item = assess_story('US-India trade deal negotiations reach a plateau', 'Global')
        self.assertEqual(item['tier'], 'Watch')
    def test_airline_fuel_charge_change_is_retained(self):
        item = assess_story('IndiGo revises fuel charges as ATF prices rise', 'India')
        self.assertEqual(item['tier'], 'Watch')
        self.assertEqual(item['category'], 'Sector & corporate news')
    def test_official_source_adds_only_a_small_confidence_boost(self):
        official = assess_story('RBI keeps repo rate unchanged', 'India', official=True)
        other = assess_story('RBI keeps repo rate unchanged', 'India', official=False)
        self.assertEqual(official['score'] - other['score'], 1)

class BriefEvidenceTests(unittest.TestCase):
    def test_partial_flow_offset(self):
        from server import flow_context
        text = flow_context({'fii_net_cr': -2846, 'dii_net_cr': 2135})
        self.assertIn('selling ₹711', text)
        self.assertIn('partially offsets', text)

    def test_crossed_resistance_not_overhead(self):
        from server import pivot_context
        text = pivot_context(22520, {'pivot': 22337, 'r1': 22494, 'r2': 22756})
        self.assertIn('22,756', text)
        self.assertNotIn('resistance above this reading: 22,494', text)

    def test_oil_decline_context(self):
        from server import synthesize_why_it_matters, get_impact_chain
        title = 'Wall Street heads for weekly gains as tech shares rebound, oil prices retreat'
        self.assertIn('Falling crude', synthesize_why_it_matters(title, 'Energy & geopolitics', {'CRUDE'}))
        self.assertEqual(get_impact_chain(title, 'Energy & geopolitics', {'CRUDE'})['rule'], 'CRUDE_DROP')

    def test_rate_cut_bet_is_not_hike(self):
        from server import get_impact_chain
        self.assertIsNone(get_impact_chain('Gold may draw support from decline in Oct Fed rate hike bet', 'Monetary policy', {'FED'}))

    def test_unknown_oil_direction_has_no_mapping(self):
        from server import get_impact_chain
        self.assertIsNone(get_impact_chain('Brent oil outlook in focus', 'Energy & geopolitics', {'CRUDE'}))

    def test_cook_hearing_group(self):
        from server import should_cluster
        self.assertTrue(should_cluster({'title': 'Trump to hold inquiry into Fed’s Lisa Cook at White House', 'published': 1}, {'title': 'Trump orders Nov. 5 Cook hearing in renewed bid to oust Fed governor Lisa Cook', 'published': 1}))

    def test_rupee_currency_move_clustering(self):
        from server import should_cluster
        s1 = {'title': 'Rupee gains 20 paise to 92.47 against dollar: How far can the currency rise from here', 'published': 100}
        s2 = {'title': 'Rupee could rise to 91.50/$ on equity inflows, says HDFC Bank\'s treasury head', 'published': 120}
        self.assertTrue(should_cluster(s1, s2))

    def test_irrelevant_stories_filtered(self):
        from server import is_irrelevant_story
        self.assertTrue(is_irrelevant_story('Rishabh Pant Scripts History With Ninth Test Ton, Surpasses Brendon McCullum; Joins Gilchrist In Elite Test Records'))
        self.assertTrue(is_irrelevant_story('Afghanistan A vs Hong Kong Live Streaming: When And Where To Watch Asia Cup Rising Stars Match?'))
        self.assertTrue(is_irrelevant_story('Navi Mumbai Water Crisis: Panvel Residents To Face One-Day Weekly Supply Disruption; Check Details'))
        self.assertTrue(is_irrelevant_story('Auto Strike In Mumbai, Thane And Other Maharashtra Cities Today? Here\'s What Commuters Need To Know'))
        self.assertTrue(is_irrelevant_story('GTA 6 Gets A Telegram Jibe From Pavel Durov; Elon Musk Joins The Conversation'))
        self.assertTrue(is_irrelevant_story('Delta Flight Delays: Here\'s What We Know As Thousands Of Flights Delayed Ahead Of Thanksgiving Holiday'))
        # Legitimate market stories should NOT be filtered
        self.assertFalse(is_irrelevant_story('Sensex Today | Stock Market Live Updates: Nifty slumps 350 points from opening highs to turn negative'))
        self.assertFalse(is_irrelevant_story('IndusInd Bank down 1% after terminating ex-CEO Kathpalia, invoking clawback'))

    def test_tata_steel_apl_apollo_clustering(self):
        from server import should_cluster
        s1 = {'title': 'Tata Steel shares fall 6% after announcing mega ₹32,266 crore APL Apollo Tubes deal', 'published': 100}
        s2 = {'title': 'Tata Steel shares fall 5% as investors weigh ₹32,000 cr APL Apollo acquisition plan | Should you buy? Check key levels', 'published': 105}
        self.assertTrue(should_cluster(s1, s2))

    def test_region_detection(self):
        from server import detect_story_region
        self.assertEqual(detect_story_region('Copper falls below $12,000 after minor recovery as metals turmoil deepens', 'India'), 'Global')
        self.assertEqual(detect_story_region('BHP plans to double South Australian copper output by 2040; shares up', 'India'), 'Global')
        self.assertEqual(detect_story_region('Momentus earnings missed by $0.04, revenue topped estimates', 'India'), 'Global')
        self.assertEqual(detect_story_region('Dollar edges off 19-month high after market rout; yen softens', 'India'), 'Global')
        self.assertEqual(detect_story_region('Yemen\'s Houthis claim attacks on Saudi oil refinery as Trump warns of new strikes next year', 'India'), 'Global')
        self.assertEqual(detect_story_region('MSCI Discussed Avoiding Indonesia Downgrade With Prabowo, Dalio', 'India'), 'Global')
        self.assertEqual(detect_story_region('Anthropic\'s stock market debut: a record IPO, a quick fade, decabillionaires, and the risks ahead | Explained', 'India'), 'Global')
        self.assertEqual(detect_story_region('Delta Flight Delays: Here\'s What We Know As Thousands Of Flights Delayed Ahead Of Thanksgiving Holiday', 'India'), 'Global')
        self.assertEqual(detect_story_region('Sensex Today | Stock Market Live Updates: Nifty slumps 350 points from opening highs to turn negative', 'Global'), 'India')
        self.assertEqual(detect_story_region('Rupee gains 20 paise to 92.47 against dollar: How far can the currency rise from here', 'Global'), 'India')
        self.assertEqual(detect_story_region('Rupee declines 23 paise to 92.85 against U.S. dollar in early trade', 'Global'), 'India')

    def test_fii_dii_fetch_or_fallback(self):
        from server import fetch_fii_dii
        import json
        from pathlib import Path
        flows = fetch_fii_dii()
        if not flows:
            # Fallback to flows.json
            p = Path(__file__).resolve().parent / 'data' / 'flows.json'
            if p.exists():
                flows = json.loads(p.read_text())
        self.assertIsNotNone(flows)
        self.assertIn('fii_net_cr', flows)
        self.assertIn('dii_net_cr', flows)
        self.assertIn('date', flows)

if __name__ == '__main__':
    unittest.main()
