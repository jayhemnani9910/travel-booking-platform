const { MongoClient } = require('mongodb');

class DealAnalytics {
  constructor(mongoClient) {
    this.client = mongoClient;
    this.db = this.client.db('kayak');
    this.deals = this.db.collection('deals');
    this.bookings = this.db.collection('bookings');
    this.userInteractions = this.db.collection('user_interactions');
  }

  async getDealPerformance(timeRange, includeAIEffectiveness = false) {
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case 'last_24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'last_7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last_30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last_90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Basic deal metrics
    const totalDeals = await this.deals.countDocuments({
      created_at: { $gte: startDate }
    });

    const activeDeals = await this.deals.countDocuments({
      created_at: { $gte: startDate },
      valid_until: { $gte: now }
    });

    const expiredDeals = await this.deals.countDocuments({
      created_at: { $gte: startDate },
      valid_until: { $lt: now }
    });

    // Deal performance by type
    const dealTypePerformance = await this.deals.aggregate([
      {
        $match: { created_at: { $gte: startDate } }
      },
      {
        $group: {
          _id: '$deal_type',
          count: { $sum: 1 },
          avgDiscount: { $avg: '$discount_percentage' },
          avgAiScore: { $avg: '$ai_score' }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Booking impact analysis
    const bookingImpact = await this.getBookingImpact(startDate);

    // AI effectiveness metrics
    let aiEffectiveness = null;
    if (includeAIEffectiveness) {
      aiEffectiveness = await this.getAIEffectiveness(startDate);
    }

    // Top performing deals
    const topDeals = await this.getTopPerformingDeals(startDate);

    return {
      totalDeals,
      activeDeals,
      expiredDeals,
      dealTypePerformance: dealTypePerformance.map(item => ({
        type: item._id,
        count: item.count,
        avgDiscount: Math.round(item.avgDiscount * 100) / 100,
        avgAiScore: Math.round(item.avgAiScore * 100) / 100
      })),
      bookingImpact,
      aiEffectiveness,
      topDeals,
      period: timeRange
    };
  }

  async getBookingImpact(startDate) {
    // Compare bookings with and without deals
    const dealsPipeline = [
      {
        $match: {
          created_at: { $gte: startDate },
          status: 'confirmed'
        }
      },
      {
        $addFields: {
          hasDeal: { $gt: [{ $size: { $ifNull: ['$applied_deals', []] } }, 0] }
        }
      },
      {
        $group: {
          _id: '$hasDeal',
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: '$total_amount' },
          averageValue: { $avg: '$total_amount' }
        }
      }
    ];

    const dealImpact = await this.bookings.aggregate(dealsPipeline).toArray();
    
    const withDeals = dealImpact.find(item => item._id === true) || { bookingCount: 0, totalRevenue: 0, averageValue: 0 };
    const withoutDeals = dealImpact.find(item => item._id === false) || { bookingCount: 0, totalRevenue: 0, averageValue: 0 };

    const totalBookings = withDeals.bookingCount + withoutDeals.bookingCount;
    const dealUtilizationRate = totalBookings > 0 
      ? Math.round((withDeals.bookingCount / totalBookings) * 10000) / 100 
      : 0;

    // Revenue uplift from deals
    const revenueUplift = withoutDeals.averageValue > 0 
      ? Math.round(((withDeals.averageValue - withoutDeals.averageValue) / withoutDeals.averageValue) * 10000) / 100 
      : 0;

    return {
      withDeals: {
        bookings: withDeals.bookingCount,
        revenue: Math.round(withDeals.totalRevenue * 100) / 100,
        averageValue: Math.round(withDeals.averageValue * 100) / 100
      },
      withoutDeals: {
        bookings: withoutDeals.bookingCount,
        revenue: Math.round(withoutDeals.totalRevenue * 100) / 100,
        averageValue: Math.round(withoutDeals.averageValue * 100) / 100
      },
      dealUtilizationRate,
      revenueUplift
    };
  }

  async getAIEffectiveness(startDate) {
    // AI scoring accuracy
    const aiScores = await this.deals.aggregate([
      {
        $match: {
          created_at: { $gte: startDate },
          ai_score: { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            scoreRange: {
              $switch: {
                branches: [
                  { case: { $lt: ['$ai_score', 3] }, then: 'low' },
                  { case: { $lt: ['$ai_score', 7] }, then: 'medium' },
                  { case: { $gte: ['$ai_score', 7] }, then: 'high' }
                ]
              }
            }
          },
          count: { $sum: 1 },
          avgConversionRate: { $avg: '$conversion_rate' },
          avgRevenueImpact: { $avg: '$revenue_impact' }
        }
      }
    ]).toArray();

    // AI recommendation click-through rates
    const clickThroughRates = await this.userInteractions.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate },
          event_type: { $in: ['deal_view', 'deal_click', 'deal_booking'] }
        }
      },
      {
        $group: {
          _id: '$event_type',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user_id' }
        }
      }
    ]).toArray();

    const views = clickThroughRates.find(item => item._id === 'deal_view') || { count: 0 };
    const clicks = clickThroughRates.find(item => item._id === 'deal_click') || { count: 0 };
    const bookings = clickThroughRates.find(item => item._id === 'deal_booking') || { count: 0 };

    const clickThroughRate = views.count > 0 
      ? Math.round((clicks.count / views.count) * 10000) / 100 
      : 0;
    const bookingConversionRate = clicks.count > 0 
      ? Math.round((bookings.count / clicks.count) * 10000) / 100 
      : 0;

    // Overall AI effectiveness score
    let score = 0;
    const highPerformanceDeals = aiScores.find(item => item._id.scoreRange === 'high');
    if (highPerformanceDeals && highPerformanceDeals.avgConversionRate) {
      score = Math.min(100, Math.round(highPerformanceDeals.avgConversionRate * 100));
    }

    return {
      score,
      aiScoreDistribution: aiScores.map(item => ({
        range: item._id.scoreRange,
        count: item.count,
        avgConversionRate: Math.round(item.avgConversionRate * 10000) / 100,
        avgRevenueImpact: Math.round(item.avgRevenueImpact * 100) / 100
      })),
      clickThroughRate,
      bookingConversionRate,
      totalRecommendations: views.count,
      totalClicks: clicks.count,
      totalBookings: bookings.count
    };
  }

  async getTopPerformingDeals(startDate, limit = 10) {
    const topDeals = await this.deals.aggregate([
      {
        $match: { created_at: { $gte: startDate } }
      },
      {
        $lookup: {
          from: 'bookings',
          let: { dealId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$$dealId', { $ifNull: ['$applied_deals', []] }] },
                    { $eq: ['$status', 'confirmed'] }
                  ]
                }
              }
            },
            {
              $group: {
                _id: null,
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$total_amount' }
              }
            }
          ],
          as: 'booking_impact'
        }
      },
      {
        $addFields: {
          actualBookings: { $ifNull: [{ $arrayElemAt: ['$booking_impact.bookingCount', 0] }, 0] },
          actualRevenue: { $ifNull: [{ $arrayElemAt: ['$booking_impact.totalRevenue', 0] }, 0] }
        }
      },
      {
        $addFields: {
          performanceScore: {
            $add: [
              { $multiply: ['$actualBookings', 10] },
              { $multiply: ['$actualRevenue', 0.01] },
              { $multiply: ['$ai_score', 5] }
            ]
          }
        }
      },
      { $sort: { performanceScore: -1 } },
      { $limit: limit }
    ]).toArray();

    return topDeals.map(deal => ({
      dealId: deal._id,
      title: deal.title,
      serviceType: deal.service_type,
      discountPercentage: deal.discount_percentage,
      aiScore: deal.ai_score,
      actualBookings: deal.actualBookings,
      actualRevenue: Math.round(deal.actualRevenue * 100) / 100,
      performanceScore: Math.round(deal.performanceScore * 100) / 100
    }));
  }

  async getDealEngagement(startDate) {
    const engagement = await this.userInteractions.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate },
          event_type: { $in: ['deal_view', 'deal_click', 'deal_share', 'deal_bookmark'] }
        }
      },
      {
        $group: {
          _id: '$event_type',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$user_id' },
          avgEngagementTime: { $avg: '$engagement_duration' }
        }
      }
    ]).toArray();

    const views = engagement.find(e => e._id === 'deal_view') || { count: 0, uniqueUsers: [] };
    const clicks = engagement.find(e => e._id === 'deal_click') || { count: 0, uniqueUsers: [] };
    const shares = engagement.find(e => e._id === 'deal_share') || { count: 0, uniqueUsers: [] };
    const bookmarks = engagement.find(e => e._id === 'deal_bookmark') || { count: 0, uniqueUsers: [] };

    return {
      views: views.count,
      uniqueViewers: views.uniqueUsers.length,
      clicks: clicks.count,
      uniqueClickers: clicks.uniqueUsers.length,
      shares: shares.count,
      bookmarks: bookmarks.count,
      engagementRate: views.count > 0 
        ? Math.round((clicks.count / views.count) * 10000) / 100 
        : 0,
      viralRate: clicks.count > 0 
        ? Math.round((shares.count / clicks.count) * 10000) / 100 
        : 0
    };
  }

  async getDealTrends(timeRange) {
    const data = await this.getDealPerformance(timeRange);
    
    // Calculate trends over time
    const dailyTrends = await this.deals.aggregate([
      {
        $match: { created_at: { $gte: this.getDateFromRange(timeRange) } }
      },
      {
        $group: {
          _id: {
            year: { $year: '$created_at' },
            month: { $month: '$created_at' },
            day: { $dayOfMonth: '$created_at' }
          },
          dealCount: { $sum: 1 },
          avgDiscount: { $avg: '$discount_percentage' },
          avgAiScore: { $avg: '$ai_score' }
        }
      },
      { $sort: { '_id': 1 } }
    ]).toArray();

    return {
      ...data,
      dailyTrends: dailyTrends.map(item => ({
        date: new Date(item._id.year, item._id.month - 1, item._id.day),
        dealCount: item.dealCount,
        avgDiscount: Math.round(item.avgDiscount * 100) / 100,
        avgAiScore: Math.round(item.avgAiScore * 100) / 100
      }))
    };
  }

  getDateFromRange(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case 'last_24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'last_7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'last_30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}

module.exports = DealAnalytics;
