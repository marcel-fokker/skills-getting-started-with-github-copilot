import unittest
from copy import deepcopy

from fastapi.testclient import TestClient

from src.app import activities, app


class SignupTests(unittest.TestCase):
    def setUp(self):
        self.original_activities = deepcopy(activities)
        self.client = TestClient(app)
        self.addCleanup(self.restore_activities)
        self.addCleanup(self.client.close)

    def restore_activities(self):
        activities.clear()
        activities.update(self.original_activities)

    def signup(self, activity, email):
        return self.client.post(
            f"/activities/{activity}/signup", params={"email": email}
        )

    def test_repeat_signup_is_rejected_without_adding_participant(self):
        email = "new-student@mergington.edu"
        participants = activities["Chess Club"]["participants"]
        original_count = len(participants)

        first = self.signup("Chess Club", email)
        second = self.signup("Chess Club", email)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(
            first.json(), {"message": f"Signed up {email} for Chess Club"}
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(
            second.json(), {"detail": "Already signed up for this activity"}
        )
        self.assertEqual(participants.count(email), 1)
        self.assertEqual(len(participants), original_count + 1)

    def test_seeded_participant_is_rejected(self):
        participants = activities["Chess Club"]["participants"]
        before = participants.copy()

        response = self.signup("Chess Club", participants[0])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(participants, before)

    def test_student_can_signup_for_another_activity(self):
        email = activities["Chess Club"]["participants"][0]

        response = self.signup("Programming Class", email)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            activities["Programming Class"]["participants"].count(email), 1
        )

    def test_unknown_activity_returns_not_found(self):
        response = self.signup("Unknown Club", "student@mergington.edu")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Activity not found"})

    def test_unregister_removes_only_selected_registration(self):
        email = activities["Chess Club"]["participants"][0]
        self.signup("Programming Class", email)
        before = activities["Chess Club"]["participants"].copy()

        response = self.client.delete(
            "/activities/Chess Club/participants", params={"email": email}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"message": f"Unregistered {email} from Chess Club"}
        )
        self.assertEqual(activities["Chess Club"]["participants"], before[1:])
        self.assertIn(email, activities["Programming Class"]["participants"])
        self.assertNotIn(
            email, self.client.get("/activities").json()["Chess Club"]["participants"]
        )
        self.assertEqual(self.signup("Chess Club", email).status_code, 200)

    def test_unregister_unknown_activity_returns_not_found(self):
        before = deepcopy(activities)
        response = self.client.delete(
            "/activities/Unknown Club/participants",
            params={"email": "student@mergington.edu"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Activity not found"})
        self.assertEqual(activities, before)

    def test_unregister_missing_participant_returns_not_found(self):
        before = deepcopy(activities)
        response = self.client.delete(
            "/activities/Chess Club/participants",
            params={"email": "missing@mergington.edu"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.json(),
            {"detail": "Student is not signed up for this activity"},
        )
        self.assertEqual(activities, before)
