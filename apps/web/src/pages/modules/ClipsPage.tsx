import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Row,
  Col,
  Typography,
  Button,
  Tag,
  Space,
  Input,
  List,
  Avatar,
  Badge,
  Modal,
  Form,
  message,
  Tooltip,
  Divider,
  Progress,
  theme,
} from 'antd';
import {
  VideoCameraOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  UserOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  ArrowRightOutlined,
  FileTextOutlined,
  AudioOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

export interface ClipChapter {
  title: string;
  startTime: number;
  endTime: number;
  summary?: string;
}

export interface ClipTranscriptSegment {
  speaker: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface ClipActionItem {
  id: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  suggestedAssignee?: string;
  timestamp: number;
  convertedRecordId?: string | number;
}

export interface ClipItem {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  duration: number; // in seconds
  createdAt: string;
  chapters: ClipChapter[];
  transcript: ClipTranscriptSegment[];
  actionItems: ClipActionItem[];
}

const DEMO_CLIPS: ClipItem[] = [
  {
    id: 'clip_equip_101',
    title: 'Pump #4 Bearing Sound Abnormality Inspection',
    description: 'Field inspection video recording on manufacturing line B. Technician identified high-frequency friction.',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 180,
    createdAt: '2026-09-24 09:30',
    chapters: [
      { title: 'Overview & Visual Check', startTime: 0, endTime: 45, summary: 'External casing inspection and thermal imaging' },
      { title: 'Acoustic Diagnostics', startTime: 45, endTime: 110, summary: 'Bearing friction frequency abnormal at 1200 RPM' },
      { title: 'Maintenance Action Decision', startTime: 110, endTime: 180, summary: 'Schedule bearing replacement before next shift' },
    ],
    transcript: [
      { speaker: 'Technician Li', startTime: 10, endTime: 25, text: 'Pump 4 shows severe bearing vibration and acoustic anomaly.' },
      { speaker: 'Technician Li', startTime: 30, endTime: 55, text: 'Vibration frequency exceeds safe operational threshold by 35%.' },
      { speaker: 'Supervisor Zhang', startTime: 60, endTime: 90, text: 'We must replace the bearing assembly urgently to avoid line stoppage.' },
      { speaker: 'Supervisor Zhang', startTime: 95, endTime: 120, text: 'Technician Li, please create a high-priority ticket and request spare part #SKF-6205.' },
      { speaker: 'Technician Li', startTime: 125, endTime: 155, text: 'Understood. Dispatching maintenance crew for 2:00 PM shift today.' },
    ],
    actionItems: [
      {
        id: 'act_1',
        title: 'Replace bearing assembly on Pump #4',
        description: 'Swap out bearing assembly #SKF-6205 and re-calibrate vibration sensor.',
        priority: 'urgent',
        suggestedAssignee: 'Technician Li',
        timestamp: 60,
      },
      {
        id: 'act_2',
        title: 'Procure spare part SKF-6205 from warehouse',
        description: 'Verify warehouse inventory and pull spare parts before 1:30 PM.',
        priority: 'high',
        suggestedAssignee: 'Warehouse Manager',
        timestamp: 95,
      },
      {
        id: 'act_3',
        title: 'Schedule Line B maintenance window',
        description: 'Inform production lead about the 30-minute scheduled pause at 2:00 PM.',
        priority: 'medium',
        suggestedAssignee: 'Supervisor Zhang',
        timestamp: 125,
      },
    ],
  },
];

export const ClipsPage: React.FC = () => {
  const { token } = theme.useToken();
  const [clips, setClips] = useState<ClipItem[]>(DEMO_CLIPS);
  const [selectedClip, setSelectedClip] = useState<ClipItem>(DEMO_CLIPS[0]);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [isNewClipModalOpen, setIsNewClipModalOpen] = useState<boolean>(false);
  const [newClipForm] = Form.useForm();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Timer for simulated screen recording
  useEffect(() => {
    let interval: any = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const seekTo = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleConvertToTicket = async (actionItem: ClipActionItem) => {
    try {
      // Simulate creating record in FormAI collection
      const newRecordId = `TICKET-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const updatedClips = clips.map((clip) => {
        if (clip.id === selectedClip.id) {
          return {
            ...clip,
            actionItems: clip.actionItems.map((item) =>
              item.id === actionItem.id ? { ...item, convertedRecordId: newRecordId } : item
            ),
          };
        }
        return clip;
      });

      setClips(updatedClips);
      const updatedSelected = updatedClips.find((c) => c.id === selectedClip.id);
      if (updatedSelected) setSelectedClip(updatedSelected);

      message.success(`✨ Created FormAI Maintenance Ticket: ${newRecordId}`);
    } catch {
      message.error('Failed to convert action item');
    }
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    message.loading('Screen & Microphone recording started...', 1.5);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    const duration = recordingSeconds;
    const newId = `clip_${Date.now()}`;
    const newClip: ClipItem = {
      id: newId,
      title: `Field Inspection Recording - ${new Date().toLocaleTimeString()}`,
      description: 'Captured via FormAI Screen & Audio Recorder',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration,
      createdAt: new Date().toLocaleString(),
      chapters: [
        { title: 'Intro & Observation', startTime: 0, endTime: Math.floor(duration / 2), summary: 'Initial visual check' },
        { title: 'Summary & Action Items', startTime: Math.floor(duration / 2), endTime: duration, summary: 'Wrap up' },
      ],
      transcript: [
        { speaker: 'Engineer', startTime: 2, endTime: 10, text: 'Beginning inspection recording for equipment monitoring.' },
        { speaker: 'Engineer', startTime: 12, endTime: duration, text: 'All pressure gauges normal. Routine filter cleanup required.' },
      ],
      actionItems: [
        {
          id: `act_${Date.now()}`,
          title: 'Routine filter cleanup and replacement',
          description: 'Scheduled filter change recorded in video.',
          priority: 'medium',
          suggestedAssignee: 'Line Operator',
          timestamp: 12,
        },
      ],
    };

    setClips([newClip, ...clips]);
    setSelectedClip(newClip);
    message.success('Recording saved and AI transcript & action items generated!');
  };

  const filteredTranscript = selectedClip.transcript.filter((t) =>
    t.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.speaker.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ padding: 24, background: token.colorBgLayout, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Space align="center">
            <VideoCameraOutlined style={{ fontSize: 24, color: token.colorPrimary }} />
            <Title level={3} style={{ margin: 0 }}>Inspection Clips & AI Work Orders</Title>
            <Tag color="blue">FormAI Internalized Module</Tag>
          </Space>
          <Paragraph type="secondary" style={{ margin: '4px 0 0 32px' }}>
            Capture field video & audio, auto-transcribe with AI, and convert action items directly into business tickets.
          </Paragraph>
        </div>
        <Space>
          {isRecording ? (
            <Button
              danger
              type="primary"
              icon={<AudioOutlined />}
              onClick={handleStopRecording}
            >
              Stop Recording ({formatTime(recordingSeconds)})
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<VideoCameraOutlined />}
              onClick={handleStartRecording}
            >
              Record New Clip
            </Button>
          )}
        </Space>
      </div>

      <Row gutter={[20, 20]}>
        {/* Main Video & Chapters Column */}
        <Col xs={24} lg={15}>
          <Card
            variant="borderless"
            style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
            styles={{ body: { padding: 0 } }}
          >
            {/* Video Player */}
            <div style={{ position: 'relative', background: '#000', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
              <video
                ref={videoRef}
                src={selectedClip.videoUrl}
                style={{ width: '100%', height: 400, display: 'block', objectFit: 'contain' }}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlay}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 16,
                  right: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: 'rgba(0,0,0,0.65)',
                  padding: '8px 16px',
                  borderRadius: 8,
                  backdropFilter: 'blur(8px)',
                }}
              >
                <Button
                  type="text"
                  shape="circle"
                  icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: 20, color: '#fff' }} /> : <PlayCircleOutlined style={{ fontSize: 20, color: '#fff' }} />}
                  onClick={togglePlay}
                />
                <Text style={{ color: '#fff', fontSize: 13, minWidth: 80 }}>
                  {formatTime(currentTime)} / {formatTime(selectedClip.duration)}
                </Text>
                <Progress
                  percent={Math.min(100, (currentTime / (selectedClip.duration || 1)) * 100)}
                  showInfo={false}
                  strokeColor={token.colorPrimary}
                  style={{ flex: 1, margin: 0 }}
                />
              </div>
            </div>

            {/* Video Details & Chapters */}
            <div style={{ padding: 20 }}>
              <Title level={4} style={{ margin: '0 0 8px' }}>{selectedClip.title}</Title>
              <Paragraph type="secondary" style={{ marginBottom: 16 }}>{selectedClip.description}</Paragraph>

              <Divider style={{ margin: '16px 0' }} />

              <Title level={5} style={{ margin: '0 0 12px' }}>
                <ClockCircleOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
                Chapters & Timeline Milestones
              </Title>
              <Space wrap size={[8, 8]}>
                {selectedClip.chapters.map((chap, idx) => {
                  const isActive = currentTime >= chap.startTime && currentTime < chap.endTime;
                  return (
                    <Button
                      key={idx}
                      size="small"
                      type={isActive ? 'primary' : 'default'}
                      onClick={() => seekTo(chap.startTime)}
                      style={{ borderRadius: 6 }}
                    >
                      {formatTime(chap.startTime)} - {chap.title}
                    </Button>
                  );
                })}
              </Space>
            </div>
          </Card>
        </Col>

        {/* AI Action Items & Transcript Column */}
        <Col xs={24} lg={9}>
          {/* AI Action Items Card */}
          <Card
            title={
              <Space>
                <ThunderboltOutlined style={{ color: '#faad14' }} />
                <span>AI Extracted Action Items</span>
                <Badge count={selectedClip.actionItems.length} style={{ backgroundColor: token.colorPrimary }} />
              </Space>
            }
            variant="borderless"
            style={{ borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <List
              dataSource={selectedClip.actionItems}
              renderItem={(item) => {
                const priorityColors: Record<string, string> = {
                  urgent: 'red',
                  high: 'orange',
                  medium: 'blue',
                  low: 'default',
                };
                return (
                  <List.Item
                    key={item.id}
                    style={{ padding: '12px 0', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
                  >
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <Space>
                          <Tag color={priorityColors[item.priority]}>{item.priority.toUpperCase()}</Tag>
                          <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
                        </Space>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => seekTo(item.timestamp)}
                          style={{ padding: 0 }}
                        >
                          {formatTime(item.timestamp)}
                        </Button>
                      </div>

                      {item.description && (
                        <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                          {item.description}
                        </Paragraph>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space size="small">
                          <Avatar size={18} icon={<UserOutlined />} />
                          <Text type="secondary" style={{ fontSize: 12 }}>{item.suggestedAssignee || 'Unassigned'}</Text>
                        </Space>

                        {item.convertedRecordId ? (
                          <Tag icon={<CheckCircleOutlined />} color="success">
                            Ticket #{item.convertedRecordId}
                          </Tag>
                        ) : (
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<CheckSquareOutlined />}
                            onClick={() => handleConvertToTicket(item)}
                          >
                            Create Ticket
                          </Button>
                        )}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          </Card>

          {/* Transcript Card */}
          <Card
            title={
              <Space>
                <FileTextOutlined style={{ color: token.colorPrimary }} />
                <span>Synchronized Transcript</span>
              </Space>
            }
            extra={
              <Input
                placeholder="Search transcript..."
                size="small"
                prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: 140 }}
                allowClear
              />
            }
            variant="borderless"
            style={{ borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
              {filteredTranscript.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>No matching speech segments found.</Text>
              ) : (
                filteredTranscript.map((seg, idx) => {
                  const isCurrent = currentTime >= seg.startTime && currentTime <= seg.endTime;
                  return (
                    <div
                      key={idx}
                      onClick={() => seekTo(seg.startTime)}
                      style={{
                        padding: '8px 12px',
                        marginBottom: 6,
                        borderRadius: 6,
                        background: isCurrent ? token.colorPrimaryBg : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        borderLeft: isCurrent ? `3px solid ${token.colorPrimary}` : '3px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <Text strong style={{ fontSize: 12, color: isCurrent ? token.colorPrimary : token.colorText }}>
                          {seg.speaker}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatTime(seg.startTime)}
                        </Text>
                      </div>
                      <Text style={{ fontSize: 12, color: isCurrent ? token.colorPrimaryText : token.colorTextSecondary }}>
                        {seg.text}
                      </Text>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ClipsPage;
