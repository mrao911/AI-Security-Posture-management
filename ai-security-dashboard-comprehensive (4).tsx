import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Upload, AlertTriangle, Activity, Brain, Shield, ArrowRight } from 'lucide-react';

const Dashboard = () => {
  // Initialize all required states
  const [fileData, setFileData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Risk colors definition
  const RISK_COLORS = {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#fef08a'
  };

  // Attack remediation info
  const attackRemediation = {
    data_poisoning: {
      description: "Malicious manipulation of training data to compromise model behavior",
      impacts: ["Model bias", "Accuracy degradation", "Backdoor vulnerabilities"],
      remediation: [
        "Implement robust data validation pipelines",
        "Regular data quality audits",
        "Cryptographic data integrity checks",
        "Anomaly detection in training data"
      ]
    },
    prompt_injection: {
      description: "Crafted inputs designed to manipulate model behavior or extract data",
      impacts: ["Unauthorized access", "Data leakage", "System compromise"],
      remediation: [
        "Input sanitization",
        "Prompt validation layers",
        "Rate limiting",
        "Context boundary enforcement"
      ]
    },
    model_inversion: {
      description: "Attacks to extract training data or model parameters",
      impacts: ["Privacy breach", "Data theft", "Model reproduction"],
      remediation: [
        "Differential privacy techniques",
        "Query result perturbation",
        "Access control mechanisms",
        "Monitoring unusual query patterns"
      ]
    }
  };

  // File upload handler
  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = text.split('\n').map(row => row.split(','));
        const headers = rows[0];
        
        const parsedData = rows.slice(1).map(row => {
          const record = {};
          headers.forEach((header, i) => {
            record[header.trim()] = row[i];
          });
          return record;
        });
        
        setFileData(parsedData);
        setShowAnalysis(false); // Reset analysis when new file is uploaded
      } catch (error) {
        console.error('Error parsing file:', error);
      }
    };
    
    reader.readAsText(file);
  }, []);

  // Analysis handler
  const handleAnalyze = () => {
    if (!fileData) return;

    const threatAnalysis = {
      totalThreats: fileData.length,
      severityLevels: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      attackTypes: {
        data_poisoning: { count: 0, successful: 0 },
        prompt_injection: { count: 0, successful: 0 },
        model_inversion: { count: 0, successful: 0 }
      },
      detectionConfidence: []
    };

    fileData.forEach(threat => {
      // Count severity levels
      if (threat.severity) {
        threatAnalysis.severityLevels[threat.severity] = 
          (threatAnalysis.severityLevels[threat.severity] || 0) + 1;
      }

      // Count attack types and success rates
      if (threat.threat_type && threatAnalysis.attackTypes[threat.threat_type]) {
        threatAnalysis.attackTypes[threat.threat_type].count++;
        if (threat.status === 'successful') {
          threatAnalysis.attackTypes[threat.threat_type].successful++;
        }
      }

      // Track confidence scores
      if (threat.confidence_score) {
        threatAnalysis.detectionConfidence.push(parseFloat(threat.confidence_score));
      }
    });

    setAnalysis(threatAnalysis);
    setShowAnalysis(true);
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50">
      {/* Upload Section */}
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="flex flex-col items-center space-y-4">
            <Upload className="w-12 h-12 text-blue-500" />
            <h2 className="text-xl font-semibold">AI Security Analysis Dashboard</h2>
            <p className="text-gray-600">Upload your security threat data CSV file</p>
            <div className="space-y-4">
              <label className="cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                Choose File
                <input type="file" onChange={handleFileUpload} className="hidden" accept=".csv" />
              </label>
              {fileData && (
                <button 
                  onClick={handleAnalyze}
                  className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600"
                >
                  Analyze Threats
                </button>
              )}
            </div>
            {fileData && (
              <div className="text-green-600">
                {fileData.length} records loaded and ready for analysis
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {showAnalysis && analysis && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.entries(analysis.severityLevels).map(([severity, count]) => (
              <Card key={severity}>
                <CardHeader>
                  <CardTitle className="capitalize">{severity} Risks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div 
                    className="text-3xl font-bold text-center"
                    style={{ color: RISK_COLORS[severity] }}
                  >
                    {count}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Attack Analysis */}
          <Card>
            <CardHeader>
              <CardTitle>Attack Distribution</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={Object.entries(analysis.attackTypes).map(([type, stats]) => ({
                    name: type.replace('_', ' '),
                    total: stats.count,
                    successful: stats.successful,
                    prevented: stats.count - stats.successful
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="successful" fill="#ef4444" name="Successful Attacks" />
                  <Bar dataKey="prevented" fill="#22c55e" name="Prevented Attacks" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Detailed Attack Analysis */}
          {Object.entries(analysis.attackTypes).map(([type, stats]) => (
            <Card key={type} className="mt-4">
              <CardHeader>
                <CardTitle className="capitalize">{type.replace('_', ' ')} Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">Attack Statistics</h3>
                    <div className="flex gap-4">
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full">
                        Total Attempts: {stats.count}
                      </span>
                      <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full">
                        Successful: {stats.successful}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2">Description</h4>
                      <p className="text-gray-600">{attackRemediation[type].description}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Potential Impacts</h4>
                      <ul className="list-disc pl-4 text-gray-600">
                        {attackRemediation[type].impacts.map((impact, i) => (
                          <li key={i}>{impact}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Remediation Steps</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {attackRemediation[type].remediation.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-gray-600">
                          <ArrowRight className="w-4 h-4 text-blue-500" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
};

export default Dashboard;
