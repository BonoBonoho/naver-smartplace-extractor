// ============================================================
// Formula X Cloud - Data Gateway
// ============================================================

var DataGateway = (function () {
  'use strict';

  function pick(obj, keys) {
    var out = {};
    keys.forEach(function (k) {
      if (obj && typeof obj[k] === 'function') out[k] = obj[k];
    });
    return out;
  }

  function create() {
    var formula = pick(FX, [
      'getProfile',
      'getSession',
      'listBranches',
      'listMyManagedBranches',
      'getPlaceWeekly',
      'getPlaceChannels',
      'getPlaceKeywords',
      'getPlaceWeeklyBatch',
      'getPlaceChannelsBatch',
      'getPlaceKeywordsBatch',
      'getSalesAggregated',
      'getAllSalesRecords',
      'listBranchWeeklyTargets',
      'upsertBranchWeeklyTarget',
      'listBranchDailyActivities',
      'upsertBranchDailyActivity',
      'listBranchMonthlyActivityTargets',
      'upsertBranchMonthlyActivityTarget',
      'listBranchWeeklyTargets',
      'adminListUsers',
      'adminUpdateUserProfile',
      'adminDeleteUserProfile',
      'adminSetTrainerPosition',
      'adminSetTrainerPositionMonthly',
      'adminAssignBranchManager',
      'adminUnassignBranchManager',
      'requestPasswordResetEmail',
      'logModeSwitchEvent',
    ]);

    // Bemove는 1차 구조 단계이므로 formula 래퍼를 우선 재사용한다.
    var bemove = pick(FX, [
      'getProfile',
      'getSession',
      'listBranches',
      'listMyManagedBranches',
      'adminListUsers',
      'adminListBranchManagers',
      'listBranchWeeklyTargets',
      'adminUpdateUserProfile',
      'adminDeleteUserProfile',
      'adminSetTrainerPosition',
      'adminSetTrainerPositionMonthly',
      'adminAssignBranchManager',
      'adminUnassignBranchManager',
      'requestPasswordResetEmail',
      'bemoveListPtMembers',
      'bemoveGetMyPtSession',
      'bemoveListOtMembers',
      'bemoveListOtConversionRecords',
      'bemoveSetOtFailureReason',
      'bemoveListSalesTransactions',
      'bemoveSalesDashboardStats',
      'bemoveInsertSalesTransaction',
      'bemoveInsertRefund',
      'bemoveUpdateSalesTransaction',
      'bemoveDeleteSalesTransaction',
      'bemoveGetMemberCumulativePayment',
      'bemoveIncrementOtLog',
      'bemoveConsumePtSession',
      'bemoveUpdatePtSessions',
      'bemoveListScheduleSlots',
      'bemoveInsertScheduleSlot',
      'bemoveDeleteScheduleSlot',
      'bemoveUpdateScheduleSlot',
      'bemoveCompleteScheduleSlot',
      'bemoveRetentionDashboard',
      'bemoveListSatisfactionTargets',
      'bemoveSendSatisfactionSurvey',
      'bemoveListMyPendingSatisfactionSurveys',
      'bemoveSubmitSatisfactionSurvey',
      'bemoveListSatisfactionSurveys',
      'bemoveTrainerSalesRanking',
      'bemoveListBranchPositionTargets',
      'bemoveUpsertBranchPositionTarget',
      'bemoveGetTrainerMonthlyGoal',
      'bemoveGetAssignableMembers',
      'bemoveAssignExistingMember',
      'bemoveAssignMemberTrainer',
      'bemoveListBranchEquipments',
      'bemoveCreateBranchEquipment',
      'bemoveDeleteBranchEquipment',
      'bemoveCreateBranchEquipmentRequest',
      'bemoveListBranchEquipmentRequests',
      'bemoveReviewBranchEquipmentRequest',
      'bemoveCreateMemberRegistrationRequest',
      'bemoveGetMemberProfile',
      'bemoveUpsertMemberProfile',
      'bemoveListMemberConsultLogs',
      'bemoveCreateMemberConsultLog',
      'bemoveListMember555Logs',
      'bemoveCreateMember555Log',
      'bemoveCreateMemberHomeworkAssignment',
      'bemoveListMemberHomeworkAssignments',
      'bemoveSetMemberHomeworkCompleted',
      'bemoveCreateMemberSelfWorkout',
      'bemoveListMemberSelfWorkouts',
      'bemoveListMemberInbodyLogs',
      'bemoveCreateMemberInbodyLog',
      'bemoveGetInbodyAiInsight',
      'bemoveAnalyzeDietFromPhotos',
      'bemoveAnalyzeDietInbodyFeedback',
      'bemoveGetExercisePrescription',
      'bemoveGetHomeworkMessage',
      'bemoveListMemberOtLogs',
      'bemoveCreateMemberOtLog',
      'uploadBemoveDietPhotos',
      'bemoveCreateMemberDietLog',
      'bemoveListMemberDietLogs',
      'bemoveUpdateMemberDietNutrition',
      'bemoveAddMemberDietFeedback',
      'bemoveDeleteMemberDietLog',
      'bemoveListMemberDietFeedbacks',
      'bemoveListMyDietAlerts',
      'bemoveMarkDietAlertRead',
      'bemoveDailyDietKcalSummary',
      // Bemove 모드 초기 단계: 공통 인증/지점 조회 재사용
      // Bemove 전용 API는 이후 여기에 추가
    ]);

    return {
      formula: formula,
      bemove: bemove,
    };
  }

  return {
    create: create,
  };
})();
